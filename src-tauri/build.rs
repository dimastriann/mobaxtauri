fn main() {
    tauri_build::build();
    // Test executables must declare Common-Controls v6 the same way
    // tauri-build declares it for the app binary: without this manifest
    // the comctl32 import of TaskDialogIndirect fails to resolve and every
    // test binary dies with STATUS_ENTRYPOINT_NOT_FOUND before main runs.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:tests-common-controls.manifest");
    }
}
