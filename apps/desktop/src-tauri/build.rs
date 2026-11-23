fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "key_status",
            "generate_key",
            "import_key",
            "seal_object",
            "open_object",
            "store_load",
            "store_save",
            "store_dirty",
            "store_clean",
            "meta_get",
            "meta_set",
            "things_read",
            "text_read",
            "text_write",
            "new_window",
            "quick_entry",
        ]),
    ))
    .expect("failed to run tauri-build");
}
