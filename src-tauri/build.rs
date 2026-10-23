fn main() {
    tauri_build::build();
    // Android 15+ devices can use 16 KB pages; NDK r27 still defaults to 4 KB.
    let target = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    if target == "android" && matches!(arch.as_str(), "aarch64" | "x86_64") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
    }
}
