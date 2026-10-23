use std::sync::atomic::{AtomicBool, Ordering};

static INSTALLING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn install_desktop_update(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    let url = window.url().map_err(|error| error.to_string())?;
    if window.label() != "main" || url.scheme() != "http" || url.host_str() != Some("127.0.0.1") {
        return Err("Updates are only available from the desktop application".into());
    }
    if [
        "MOMP_WEB_DISABLE_SELF_UPDATE",
        "OMP_WEB_DISABLE_SELF_UPDATE",
    ]
    .iter()
    .any(|name| std::env::var(name).as_deref() == Ok("1"))
    {
        return Err("Automatic updates have been disabled for this application".into());
    }
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("An update is already being installed".into());
    }
    let result = tauri::async_runtime::spawn_blocking(prepare_update)
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result);
    if result.is_ok() {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(2));
            app.exit(0);
        });
    } else {
        INSTALLING.store(false, Ordering::SeqCst);
    }
    result
}

fn validate_digest(value: &str) -> Result<String, String> {
    let digest = value
        .strip_prefix("sha256:")
        .ok_or("Release asset has no SHA-256 digest")?;
    if digest.len() != 64 || !digest.bytes().all(|value| value.is_ascii_hexdigit()) {
        return Err("Release asset has an invalid SHA-256 digest".into());
    }
    Ok(digest.to_ascii_lowercase())
}

fn validate_payload(file: &mut std::fs::File) -> Result<(), String> {
    use std::io::{Read, Seek, SeekFrom};
    let length = file.metadata().map_err(|error| error.to_string())?.len();
    if length < 18 {
        return Err("Downloaded executable is truncated".into());
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut header = [0u8; 2];
    file.read_exact(&mut header)
        .map_err(|error| error.to_string())?;
    file.seek(SeekFrom::End(-16))
        .map_err(|error| error.to_string())?;
    let mut trailer = [0u8; 16];
    file.read_exact(&mut trailer)
        .map_err(|error| error.to_string())?;
    let payload_size = u64::from_le_bytes(trailer[..8].try_into().unwrap());
    if &header != b"MZ"
        || &trailer[8..] != b"MOMP_SFX"
        || payload_size == 0
        || payload_size > length - 18
    {
        return Err("Release is not a complete momp portable executable".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn prepare_update() -> Result<(), String> {
    Err("Automatic portable updates are currently supported on Windows only".into())
}

#[cfg(windows)]
fn prepare_update() -> Result<(), String> {
    use reqwest::blocking::Client;
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    use std::os::windows::process::CommandExt;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    let client = Client::builder()
        .user_agent("momp-desktop-updater")
        .https_only(true)
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(|error| error.to_string())?;
    let release: serde_json::Value = client
        .get("https://api.github.com/repos/domovoyproj/momp/releases/latest")
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| error.to_string())?
        .json()
        .map_err(|error| error.to_string())?;
    if release["draft"].as_bool() != Some(false) || release["prerelease"].as_bool() != Some(false) {
        return Err("Only stable published releases can be installed".into());
    }
    let tag = release["tag_name"]
        .as_str()
        .ok_or("Release version missing")?;
    let next =
        semver::Version::parse(tag.trim_start_matches('v')).map_err(|error| error.to_string())?;
    let current =
        semver::Version::parse(env!("CARGO_PKG_VERSION")).map_err(|error| error.to_string())?;
    if next <= current || !next.pre.is_empty() {
        return Err("No newer stable release is available".into());
    }
    let asset = release["assets"]
        .as_array()
        .and_then(|assets| assets.iter().find(|asset| asset["name"] == "momp.exe"))
        .ok_or("This release has no Windows executable")?;
    let digest = validate_digest(asset["digest"].as_str().unwrap_or(""))?;
    let expected_size = asset["size"].as_u64().ok_or("Release size missing")?;
    if expected_size < 18 || expected_size > 2 * 1024 * 1024 * 1024 {
        return Err("Unexpected release size".into());
    }
    let download = asset["browser_download_url"]
        .as_str()
        .ok_or("Download URL missing")?;
    let expected_url =
        format!("https://github.com/domovoyproj/momp/releases/download/{tag}/momp.exe");
    if download != expected_url {
        return Err("Untrusted update URL".into());
    }
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let parent = executable.parent().ok_or("Executable directory missing")?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let staging = parent.join(format!(".momp-update-{stamp}"));
    std::fs::create_dir(&staging).map_err(|error| {
        format!("Cannot write beside momp.exe. Move it to a writable folder: {error}")
    })?;
    let downloaded = staging.join("momp.exe");
    let result = (|| -> Result<(), String> {
        let mut response = client
            .get(download)
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|error| error.to_string())?;
        let mut output = std::fs::File::create(&downloaded).map_err(|error| error.to_string())?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 65536];
        let mut total = 0u64;
        loop {
            let count = response
                .read(&mut buffer)
                .map_err(|error| error.to_string())?;
            if count == 0 {
                break;
            }
            total += count as u64;
            if total > expected_size {
                return Err("Download exceeds declared size".into());
            }
            hasher.update(&buffer[..count]);
            output
                .write_all(&buffer[..count])
                .map_err(|error| error.to_string())?;
        }
        output.sync_all().map_err(|error| error.to_string())?;
        drop(output);
        if total != expected_size || format!("{:x}", hasher.finalize()) != digest {
            return Err("Update verification failed: SHA-256 or size mismatch".into());
        }
        validate_payload(
            &mut std::fs::File::open(&downloaded).map_err(|error| error.to_string())?,
        )?;
        let script = staging.join("install.ps1");
        std::fs::write(&script, include_str!("update-helper.ps1"))
            .map_err(|error| error.to_string())?;
        let mut helper = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&script)
            .env("MOMP_UPDATE_TARGET", &executable)
            .env("MOMP_UPDATE_SOURCE", &downloaded)
            .env("MOMP_UPDATE_PARENT", std::process::id().to_string())
            .env("MOMP_UPDATE_SHA256", &digest)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|error| error.to_string())?;
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        while !staging.join("ready").is_file() {
            if helper
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_some()
            {
                return Err("Update helper could not start. The installed application has not been changed.".into());
            }
            if std::time::Instant::now() >= deadline {
                let _ = helper.kill();
                let _ = helper.wait();
                return Err(
                    "Update helper timed out. The installed application has not been changed."
                        .into(),
                );
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&downloaded);
        let _ = std::fs::remove_file(staging.join("install.ps1"));
        let _ = std::fs::remove_dir(&staging);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_full_sha256_digests() {
        assert!(validate_digest("sha256:123").is_err());
        assert!(validate_digest(&format!("sha512:{}", "a".repeat(64))).is_err());
        assert_eq!(
            validate_digest(&format!("sha256:{}", "A".repeat(64))).unwrap(),
            "a".repeat(64)
        );
    }

    #[test]
    fn rejects_truncated_or_non_sfx_executables() {
        let path = std::env::temp_dir().join(format!("momp-update-test-{}", std::process::id()));
        std::fs::write(&path, b"MZnot a complete executable").unwrap();
        assert!(validate_payload(&mut std::fs::File::open(&path).unwrap()).is_err());
        let mut data = b"MZpayload".to_vec();
        data.extend(7u64.to_le_bytes());
        data.extend(b"MOMP_SFX");
        std::fs::write(&path, data).unwrap();
        assert!(validate_payload(&mut std::fs::File::open(&path).unwrap()).is_ok());
        std::fs::remove_file(path).unwrap();
    }
}
