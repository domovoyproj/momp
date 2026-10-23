use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_STAGING_ID: AtomicU64 = AtomicU64::new(0);

fn unique_suffix() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = NEXT_STAGING_ID.fetch_add(1, Ordering::Relaxed);
    format!("{}-{timestamp}-{sequence}", std::process::id())
}

fn runtime_ready(directory: &Path, bun_name: &str) -> bool {
    [
        bun_name,
        ".next/BUILD_ID",
        "node_modules/next/dist/bin/next",
    ]
    .iter()
    .all(|name| {
        fs::metadata(directory.join(name))
            .map(|metadata| metadata.is_file() && metadata.len() > 0)
            .unwrap_or(false)
    })
}

struct StagingDirectory(PathBuf);

impl Drop for StagingDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub fn ensure_runtime(
    runtime_base: &Path,
    version: &str,
    bun_name: &str,
    extract: impl FnOnce(&Path) -> Result<bool, String>,
) -> Result<Option<PathBuf>, String> {
    let runtime_dir = runtime_base.join(format!("app-v{version}"));
    if runtime_ready(&runtime_dir, bun_name) {
        return Ok(Some(runtime_dir));
    }

    fs::create_dir_all(runtime_base)
        .map_err(|error| format!("cannot create runtime root: {error}"))?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(runtime_base.join(format!("app-v{version}.lock")))
        .map_err(|error| format!("cannot open extraction lock: {error}"))?;
    lock.lock()
        .map_err(|error| format!("cannot acquire extraction lock: {error}"))?;

    if runtime_ready(&runtime_dir, bun_name) {
        return Ok(Some(runtime_dir));
    }

    let suffix = unique_suffix();
    let staging_path = runtime_base.join(format!("app-v{version}.{suffix}.partial"));
    fs::create_dir(&staging_path)
        .map_err(|error| format!("cannot create extraction staging: {error}"))?;
    let staging = StagingDirectory(staging_path);
    if !extract(&staging.0)? {
        return Ok(None);
    }
    if !runtime_ready(&staging.0, bun_name) {
        return Err(
            "extracted payload requires non-empty Bun, BUILD_ID, and Next.js entry files".into(),
        );
    }
    if runtime_ready(&runtime_dir, bun_name) {
        return Ok(Some(runtime_dir));
    }
    if runtime_dir.exists() {
        let incomplete = runtime_base.join(format!("app-v{version}.{suffix}.incomplete"));
        fs::rename(&runtime_dir, &incomplete)
            .map_err(|error| format!("cannot preserve incomplete runtime: {error}"))?;
    }
    fs::rename(&staging.0, &runtime_dir)
        .map_err(|error| format!("failed to promote extracted payload: {error}"))?;
    Ok(Some(runtime_dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{File, TryLockError};
    use std::process::Command;
    use std::sync::{mpsc, Arc};
    use std::thread;
    use std::time::Duration;

    const BUN_NAME: &str = "bun-test";
    const VERSION: &str = "1.5.0";

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("momp-extraction-test-{}", unique_suffix()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_runtime(path: &Path) {
        fs::create_dir_all(path.join(".next")).unwrap();
        fs::create_dir_all(path.join("node_modules/next/dist/bin")).unwrap();
        fs::write(path.join(BUN_NAME), b"runtime").unwrap();
        fs::write(path.join(".next/BUILD_ID"), b"build-id").unwrap();
        fs::write(path.join("node_modules/next/dist/bin/next"), b"next-cli").unwrap();
    }

    #[test]
    fn cached_runtime_does_not_extract_or_remove_other_versions() {
        let fixture = Fixture::new();
        let current = fixture.0.join(format!("app-v{VERSION}"));
        let other = fixture.0.join("app-v1.6.0.partial");
        write_runtime(&current);
        fs::create_dir(&other).unwrap();
        let result = ensure_runtime(&fixture.0, VERSION, BUN_NAME, |_| {
            panic!("unexpected extraction")
        });
        assert_eq!(result.unwrap(), Some(current));
        assert!(other.is_dir());
    }

    #[test]
    fn failed_extraction_removes_only_its_unique_staging() {
        let fixture = Fixture::new();
        let other = fixture.0.join("app-v1.5.0.partial");
        fs::create_dir(&other).unwrap();
        let mut own_staging = PathBuf::new();
        let result = ensure_runtime(&fixture.0, VERSION, BUN_NAME, |staging| {
            own_staging = staging.to_path_buf();
            assert_ne!(staging, other);
            write_runtime(staging);
            Err("interrupted extraction".into())
        });
        assert!(result.is_err());
        assert!(!own_staging.exists());
        assert!(other.is_dir());
        assert!(!fixture.0.join(format!("app-v{VERSION}")).exists());
    }

    #[test]
    fn incomplete_payload_is_not_promoted() {
        for missing in [
            BUN_NAME,
            ".next/BUILD_ID",
            "node_modules/next/dist/bin/next",
        ] {
            let fixture = Fixture::new();
            let result = ensure_runtime(&fixture.0, VERSION, BUN_NAME, |staging| {
                write_runtime(staging);
                fs::remove_file(staging.join(missing)).unwrap();
                Ok(true)
            });
            assert!(result.is_err(), "{missing} is required");
            assert!(!fixture.0.join(format!("app-v{VERSION}")).exists());
        }
    }

    #[test]
    fn empty_required_runtime_files_trigger_fresh_extraction() {
        for empty in [
            BUN_NAME,
            ".next/BUILD_ID",
            "node_modules/next/dist/bin/next",
        ] {
            let fixture = Fixture::new();
            let current = fixture.0.join(format!("app-v{VERSION}"));
            write_runtime(&current);
            fs::write(current.join(empty), b"").unwrap();
            let mut extracted = false;
            ensure_runtime(&fixture.0, VERSION, BUN_NAME, |staging| {
                extracted = true;
                write_runtime(staging);
                Ok(true)
            })
            .unwrap();
            assert!(
                extracted,
                "empty {empty} must invalidate the cached runtime"
            );
            assert!(runtime_ready(&current, BUN_NAME));
        }
    }

    #[test]
    fn preserves_invalid_previous_runtime_and_other_versions() {
        let fixture = Fixture::new();
        let current = fixture.0.join(format!("app-v{VERSION}"));
        fs::create_dir(&current).unwrap();
        fs::write(current.join("previous-marker"), b"preserve").unwrap();
        let other = fixture.0.join("app-v1.4.9");
        write_runtime(&other);
        ensure_runtime(&fixture.0, VERSION, BUN_NAME, |staging| {
            write_runtime(staging);
            Ok(true)
        })
        .unwrap();
        assert!(runtime_ready(&current, BUN_NAME));
        assert!(runtime_ready(&other, BUN_NAME));
        assert!(fs::read_dir(&fixture.0)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| {
                entry.file_name().to_string_lossy().ends_with(".incomplete")
                    && entry.path().join("previous-marker").is_file()
            }));
    }

    #[test]
    fn concurrent_call_waits_then_reuses_the_promoted_runtime() {
        let fixture = Fixture::new();
        let count = Arc::new(AtomicU64::new(0));
        let first_root = fixture.0.clone();
        let first_count = count.clone();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first = thread::spawn(move || {
            ensure_runtime(&first_root, VERSION, BUN_NAME, |staging| {
                first_count.fetch_add(1, Ordering::Relaxed);
                started_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                write_runtime(staging);
                Ok(true)
            })
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let second_root = fixture.0.clone();
        let second_count = count.clone();
        let (attempt_tx, attempt_rx) = mpsc::channel();
        let (extracted_tx, extracted_rx) = mpsc::channel();
        let second = thread::spawn(move || {
            attempt_tx.send(()).unwrap();
            ensure_runtime(&second_root, VERSION, BUN_NAME, |staging| {
                second_count.fetch_add(1, Ordering::Relaxed);
                extracted_tx.send(()).unwrap();
                write_runtime(staging);
                Ok(true)
            })
        });
        attempt_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let premature_extraction = extracted_rx.recv_timeout(Duration::from_millis(100));
        release_tx.send(()).unwrap();
        let first_result = first.join().unwrap().unwrap();
        let second_result = second.join().unwrap().unwrap();
        assert!(premature_extraction.is_err());
        assert_eq!(first_result, second_result);
        assert_eq!(count.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn extraction_lock_blocks_another_process() {
        let fixture = Fixture::new();
        let path = fixture.0.join("probe.lock");
        let lock = File::create(&path).unwrap();
        lock.lock().unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .arg("runtime_extraction_lock_probe")
            .arg("--nocapture")
            .env("MOMP_RUNTIME_EXTRACTION_TEST_LOCK", &path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn runtime_extraction_lock_probe() {
        let Some(path) = std::env::var_os("MOMP_RUNTIME_EXTRACTION_TEST_LOCK") else {
            return;
        };
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .unwrap();
        assert!(matches!(lock.try_lock(), Err(TryLockError::WouldBlock)));
    }
}
