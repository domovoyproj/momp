use std::fs;
use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=server_payload.tar.gz");
    let payload_path = Path::new("server_payload.tar.gz");
    if !payload_path.exists() {
        // Create a minimal placeholder archive so include_bytes! succeeds during cargo check / dev
        let _ = fs::write(payload_path, b"");
    }
    tauri_build::build();
}

