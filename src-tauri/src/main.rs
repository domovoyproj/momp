// omp-desktop: Tauri v2 desktop shell for omp-web.
//
// In release builds the bundled Bun runtime starts the omp-web Next.js server
// as a sidecar on a free loopback port, then the main window navigates to
// http://127.0.0.1:<port>. In dev mode (`bun run tauri dev`) the server is
// already running via beforeDevCommand and the webview loads devUrl.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use flate2::read::GzDecoder;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tar::Archive;

use tauri::{AppHandle, Manager, Url};

const MAGIC_SFX: &[u8; 8] = b"MOMP_SFX";

const WINDOW_LABEL: &str = "main";
const HOST: &str = "127.0.0.1";
const NEXT_ENTRY: &str = "node_modules/next/dist/bin/next";

/// Appends a line to the desktop log in the temp dir and mirrors it to
/// stderr. GUI-launched apps have no terminal, so stderr alone is
/// unreachable; the file makes the sidecar observable.
fn desktop_log(line: &str) {
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(std::env::temp_dir().join("momp-desktop.log"))
    {
        let _ = writeln!(file, "{line}");
    }
    eprintln!("{line}");
}

/// Spawns a reader that forwards a child stream line-by-line to the log.
fn drain_to_log<R: Read + Send + 'static>(stream: R) {
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            desktop_log(&format!("[server] {line}"));
        }
    });
}

/// Name of the bundled Bun runtime for the compiled target. Both macOS
/// binaries are always bundled (universal app), so the architecture selects
/// the right one at runtime.
fn bun_binary_name() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "bun-darwin-aarch64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "bun-darwin-x64"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "bun-windows-x64.exe"
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64"),
    )))]
    {
        "bun-unsupported-platform"
    }
}

/// The running Bun sidecar, kept in managed state so its process group can be
/// torn down when the app exits.
struct ServerChild(Mutex<Option<Child>>);

impl ServerChild {
    fn kill(&self) {
        let child = self.0.lock().ok().and_then(|mut guard| guard.take());
        if let Some(child) = child {
            kill_process_group(child.id());
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Track the webview URL — ground truth for "stuck on the
            // placeholder" vs "server page loaded" vs "load failed".
            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                thread::spawn(move || {
                    let mut last: Option<String> = None;
                    loop {
                        let current = window.url().map(|url| url.to_string());
                        let current = match current {
                            Ok(url) => url,
                            Err(_) => String::from("<unavailable>"),
                        };
                        if last.as_deref() != Some(current.as_str()) {
                            last = Some(current.clone());
                            desktop_log(&format!("[webview] url: {current}"));
                        }
                        thread::sleep(Duration::from_millis(500));
                    }
                });
            }
            // Start the bundled server whenever this binary carries an embedded
            // SFX payload (a released single-exe), regardless of Tauri's dev
            // detection: a raw `cargo build` launcher reports is_dev()==true even
            // in --release, which would otherwise skip the server and leave the
            // webview stranded on the dead devUrl. `tauri dev` binaries have no
            // payload, so development still uses the dev server.
            if has_embedded_payload() || !tauri::is_dev() {
                purge_service_worker(app);
                if let Err(error) = start_server(app) {
                    desktop_log(&format!("[momp-desktop] failed to start the bundled server: {error}"));
                    app.handle().exit(1);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build momp application")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                if let Some(server) = app.try_state::<ServerChild>() {
                    server.kill();
                }
            }
        });
}

/// Removes the WebView2 Service Worker registration and its CacheStorage so a
/// stale SW from an older build can never trap the app on a cached
/// offline.html. Local Storage is a sibling folder and is preserved, so the
/// fixed-port localStorage state survives. Best-effort; ignores errors.
fn purge_service_worker(app: &tauri::App) {
    let Ok(mut dir) = app.path().app_local_data_dir() else {
        return;
    };
    dir.push("EBWebView");
    dir.push("Default");
    dir.push("Service Worker");
    if dir.exists() {
        match std::fs::remove_dir_all(&dir) {
            Ok(()) => desktop_log("[momp-desktop] purged stale service worker cache"),
            Err(e) => desktop_log(&format!(
                "[momp-desktop] could not purge service worker ({e}); continuing"
            )),
        }
    }
}

fn start_server(app: &mut tauri::App) -> Result<(), String> {
    let port = free_port().map_err(|error| error.to_string())?;
    let root = ensure_server_extracted(app)?;

    let mut bun_candidates = vec![
        root.join(bun_binary_name()),
    ];
    if let Ok(resources) = app.path().resource_dir() {
        bun_candidates.push(resources.join(bun_binary_name()));
        if let Some(parent) = resources.parent() {
            bun_candidates.push(parent.join(bun_binary_name()));
        }
    }

    let bun = bun_candidates
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| {
            format!(
                "bundled Bun runtime ({}) not found in {}",
                bun_binary_name(),
                root.display()
            )
        })?;

    let mut command = Command::new(&bun);
    command
        .current_dir(&root)
        .arg("--bun")
        .arg(NEXT_ENTRY)
        .arg("start")
        .arg("-H")
        .arg(HOST)
        .arg("-p")
        .arg(port.to_string())
        // Relative project paths in the browser resolve against this directory
        .env("MOMP_WEB_DISABLE_SELF_UPDATE", "1")
        .env("OMP_DESKTOP", "1")
        .env(
            "OMP_WEB_LAUNCH_CWD",
            app.path().home_dir().map_err(|error| error.to_string())?,
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    make_process_group(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to spawn bundled Bun ({}): {error}", bun.display()))?;

    // Drain the server's stdout/stderr into the desktop log; the pipes would
    // otherwise fill up and block the child.
    if let Some(stream) = child.stdout.take() {
        drain_to_log(stream);
    }
    if let Some(stream) = child.stderr.take() {
        drain_to_log(stream);
    }

    app.manage(ServerChild(Mutex::new(Some(child))));

    let handle = app.handle().clone();
    thread::spawn(move || match wait_until_ready(port) {
        Ok(()) => {
            desktop_log(&format!("[momp-desktop] server ready on http://{HOST}:{port}/"));
            navigate_main(&handle, port);
        }
        Err(error) => {
            desktop_log(&format!("[momp-desktop] bundled server failed to become ready: {error}"));
            handle.exit(1);
        }
    });

    desktop_log(&format!("[momp-desktop] momp server starting on http://{HOST}:{port}/"));
    Ok(())
}

/// Reserves a loopback port for the bundled server.
///
/// Prefers a fixed port so the webview origin stays constant across restarts —
/// otherwise every launch is a new `http://127.0.0.1:<random>` origin and all
/// browser `localStorage` (removed projects, drafts, theme, collapsed groups)
/// is wiped, which made deleted project folders reappear after a restart. Falls
/// back to an OS-assigned port only when the preferred one is already taken.
fn free_port() -> std::io::Result<u16> {
    const PREFERRED_PORT: u16 = 30140;
    if let Ok(listener) = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, PREFERRED_PORT))) {
        drop(listener);
        return Ok(PREFERRED_PORT);
    }
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))?;
    Ok(listener.local_addr()?.port())
}

use std::io::{Seek, SeekFrom};

/// Returns true when the currently executing binary carries an appended SFX
/// payload (identified by the 16-byte trailer ending in `MOMP_SFX`). This is
/// the reliable signal that we are a released single-exe rather than a bare
/// `cargo build` / `tauri dev` binary.
fn has_embedded_payload() -> bool {
    let Ok(current_exe) = std::env::current_exe() else {
        return false;
    };
    let Ok(mut file) = std::fs::File::open(&current_exe) else {
        return false;
    };
    let Ok(meta) = file.metadata() else {
        return false;
    };
    if meta.len() < 16 {
        return false;
    }
    if file.seek(SeekFrom::End(-16)).is_err() {
        return false;
    }
    let mut footer = [0u8; 16];
    if file.read_exact(&mut footer).is_err() {
        return false;
    }
    &footer[8..16] == MAGIC_SFX
}

/// Extracts appended SFX payload (tar or tar.gz) from the currently executing binary if present.
fn extract_sfx_payload(runtime_dir: &PathBuf) -> Result<bool, String> {
    let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut file = std::fs::File::open(&current_exe)
        .map_err(|e| format!("cannot open executable ({}): {e}", current_exe.display()))?;
    let file_len = file.metadata().map_err(|e| e.to_string())?.len();
    if file_len < 16 {
        return Ok(false);
    }

    file.seek(SeekFrom::End(-16)).map_err(|e| e.to_string())?;
    let mut footer = [0u8; 16];
    file.read_exact(&mut footer).map_err(|e| e.to_string())?;

    if &footer[8..16] != MAGIC_SFX {
        return Ok(false);
    }

    let payload_len = u64::from_le_bytes(footer[0..8].try_into().unwrap());
    if payload_len == 0 || payload_len > file_len - 16 {
        return Err("corrupt or invalid SFX payload footer".into());
    }

    let payload_offset = file_len - 16 - payload_len;
    file.seek(SeekFrom::Start(payload_offset)).map_err(|e| e.to_string())?;

    desktop_log(&format!(
        "[momp-desktop] extracting SFX payload ({:.1} MB) to {}",
        payload_len as f64 / 1024.0 / 1024.0,
        runtime_dir.display()
    ));

    let _ = std::fs::create_dir_all(runtime_dir);

    // Inspect magic bytes to detect gzip vs uncompressed tar
    let mut magic = [0u8; 2];
    file.read_exact(&mut magic).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(payload_offset)).map_err(|e| e.to_string())?;

    let stream = file.take(payload_len);
    let buf_reader = std::io::BufReader::with_capacity(1024 * 1024 * 4, stream);

    if magic == [0x1f, 0x8b] {
        let decoder = GzDecoder::new(buf_reader);
        let mut archive = Archive::new(decoder);
        archive
            .unpack(runtime_dir)
            .map_err(|e| format!("failed to extract SFX gzip archive: {e}"))?;
    } else {
        let mut archive = Archive::new(buf_reader);
        archive
            .unpack(runtime_dir)
            .map_err(|e| format!("failed to extract SFX tar archive: {e}"))?;
    }

    Ok(true)
}

/// Ensures the server payload is extracted to the local app data folder
/// for the current application version (%LOCALAPPDATA%/momp/app-v<VERSION>).
fn ensure_server_extracted(app: &tauri::App) -> Result<PathBuf, String> {
    let version = app.package_info().version.to_string();
    let runtime_base = if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        PathBuf::from(local_app_data).join("momp")
    } else if let Ok(data_dir) = app.path().app_local_data_dir() {
        data_dir
    } else {
        std::env::temp_dir().join("momp")
    };

    let runtime_dir = runtime_base.join(format!("app-v{}", version));
    let bun_path = runtime_dir.join(bun_binary_name());
    let next_path = runtime_dir.join(".next");

    // 1. If already extracted, return right away
    if bun_path.is_file() && next_path.is_dir() {
        return Ok(runtime_dir);
    }

    // 2. Extract into a staging dir, then atomically promote it. A partially
    //    extracted app dir (interrupted by a crash, AV, or disk-full) must never
    //    be left under the final name.
    let staging = runtime_base.join(format!("app-v{}.partial", version));
    let _ = std::fs::remove_dir_all(&staging);
    match extract_sfx_payload(&staging) {
        Ok(true) => {
            let _ = std::fs::remove_dir_all(&runtime_dir);
            if let Err(err) = std::fs::rename(&staging, &runtime_dir) {
                let _ = std::fs::remove_dir_all(&staging);
                return Err(format!("failed to promote extracted payload: {err}"));
            }
            let cleanup_base = runtime_base.clone();
            let current_version = version.clone();
            thread::spawn(move || {
                clean_old_versions(&cleanup_base, &current_version);
            });
            return Ok(runtime_dir);
        }
        Ok(false) => {
            let _ = std::fs::remove_dir_all(&staging);
        }
        Err(err) => {
            let _ = std::fs::remove_dir_all(&staging);
            desktop_log(&format!("[momp-desktop] SFX extraction error: {err}"));
        }
    }

    // 3. Fallback for dev / uncompressed builds
    if let Ok(resources) = app.path().resource_dir() {
        if resources.join(".next").is_dir() {
            return Ok(resources);
        }
        if resources.join("server").join(".next").is_dir() {
            return Ok(resources.join("server"));
        }
    }

    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(parent) = exe_dir.parent() {
            if parent.join(".next").is_dir() {
                return Ok(parent.to_path_buf());
            }
            if parent.join("server").join(".next").is_dir() {
                return Ok(parent.join("server"));
            }
        }
    }

    Err(format!(
        "server payload not found in {} or standalone executable",
        runtime_dir.display()
    ))
}

fn clean_old_versions(base: &PathBuf, current_version: &str) {
    let current_dir_name = format!("app-v{}", current_version);
    if let Ok(entries) = std::fs::read_dir(base) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with("app-v") && name != current_dir_name {
                        desktop_log(&format!("[cleanup] removing old version folder: {}", path.display()));
                        let _ = std::fs::remove_dir_all(&path);
                    }
                }
            }
        }
    }
}

/// Polls the server until it answers an HTTP request (up to 60s).
fn wait_until_ready(port: u16) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut last = String::from("no HTTP response");
    while Instant::now() < deadline {
        match http_get(port) {
            Ok(true) => return Ok(()),
            Ok(false) => last = String::from("server answered with a non-HTTP reply"),
            Err(error) => last = error.to_string(),
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err(format!("timed out after 60s: {last}"))
}

fn http_get(port: u16) -> std::io::Result<bool> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(500))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.write_all(
        format!("GET / HTTP/1.1\r\nHost: {HOST}:{port}\r\nConnection: close\r\n\r\n").as_bytes(),
    )?;
    let mut buffer = [0_u8; 64];
    let read = stream.read(&mut buffer)?;
    Ok(read > 0 && buffer.starts_with(b"HTTP/"))
}

fn navigate_main(handle: &AppHandle, port: u16) {
    let url = match Url::parse(&format!("http://{HOST}:{port}/")) {
        Ok(url) => url,
        Err(error) => {
            desktop_log(&format!("[omp-desktop] invalid server URL: {error}"));
            handle.exit(1);
            return;
        }
    };
    match handle.get_webview_window(WINDOW_LABEL) {
        Some(window) => {
            if let Err(error) = window.navigate(url) {
                desktop_log(&format!("[omp-desktop] failed to navigate to the omp-web server: {error}"));
                handle.exit(1);
            }
        }
        None => {
            desktop_log("[omp-desktop] main window not found");
            handle.exit(1);
        }
    }
}

/// Runs the child as a process-group leader so the whole tree can be torn
/// down with one signal (unix: `kill -TERM -pid`; windows: `taskkill /T`).
fn make_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW — the second flag keeps
        // the console-subsystem Bun sidecar from flashing a cmd window when the
        // GUI app launches it.
        command.creation_flags(0x0000_0200 | 0x0800_0000);
    }
}

/// Fire-and-forget termination of the sidecar's process group.
fn kill_process_group(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .spawn();
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/pid", &pid.to_string(), "/T", "/F"])
            // CREATE_NO_WINDOW — no cmd flash on teardown either.
            .creation_flags(0x0800_0000)
            .status();
    }
}
