mod folder;
mod store;
mod themes;
mod things;
mod vault;

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use nostr::prelude::{Event, Keys, ToBech32};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use store::{Dirty, Published, Store};

const KEYCHAIN_SERVICE: &str = "app.stuff.desktop";

/// `STUFF_PROFILE` gives a second instance its own store and keychain entry, for local sync tests.
fn profile() -> Option<String> {
    std::env::var("STUFF_PROFILE")
        .ok()
        .filter(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric()))
}

#[derive(Default)]
struct Vault {
    keys: Mutex<Option<Keys>>,
}

fn keychain() -> Result<keyring::Entry, String> {
    let account = match profile() {
        Some(p) => format!("nsec-{p}"),
        None => "nsec".into(),
    };
    keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())
}

fn npub(keys: &Keys) -> String {
    keys.public_key()
        .to_bech32()
        .expect("public keys always encode")
}

impl Vault {
    fn stored(&self) -> Result<Option<Keys>, String> {
        let mut cached = self.keys.lock().unwrap();
        if cached.is_none() {
            match keychain()?.get_password() {
                Ok(nsec) => *cached = Some(Keys::parse(&nsec).map_err(|e| e.to_string())?),
                Err(keyring::Error::NoEntry) => {}
                Err(e) => return Err(format!("stuff can't read the keychain: {e}")),
            }
        }
        Ok(cached.clone())
    }

    fn keys(&self) -> Result<Keys, String> {
        self.stored()?.ok_or_else(|| "Set up a key first".into())
    }

    fn store(&self, keys: Keys) -> Result<String, String> {
        if self.stored()?.is_some() {
            return Err("A key is already stored".into());
        }
        let nsec = keys.secret_key().to_bech32().map_err(|e| e.to_string())?;
        keychain()?.set_password(&nsec).map_err(|e| e.to_string())?;
        let npub = npub(&keys);
        *self.keys.lock().unwrap() = Some(keys);
        Ok(npub)
    }
}

/// Keychain calls can block on a macOS password prompt, so they run off the main thread.
async fn keychain_task<T: Send + 'static>(
    app: AppHandle,
    task: impl FnOnce(&Vault) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || task(&app.state::<Vault>()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn key_status(app: AppHandle) -> Result<Option<String>, String> {
    keychain_task(app, |v| Ok(v.stored()?.map(|k| npub(&k)))).await
}

#[tauri::command]
async fn generate_key(app: AppHandle) -> Result<String, String> {
    keychain_task(app, |v| v.store(Keys::generate())).await
}

#[tauri::command]
async fn import_key(app: AppHandle, nsec: String) -> Result<String, String> {
    let keys = Keys::parse(nsec.trim()).map_err(|_| "That is not a valid nsec".to_string())?;
    keychain_task(app, |v| v.store(keys)).await
}

#[tauri::command]
async fn seal_object(
    app: AppHandle,
    id: String,
    plaintext: String,
    created_at: u64,
) -> Result<Event, String> {
    let keys = keychain_task(app, Vault::keys).await?;
    vault::seal(&keys, &id, &plaintext, created_at)
}

#[tauri::command]
async fn open_object(app: AppHandle, event: Event) -> Result<String, String> {
    let keys = keychain_task(app, Vault::keys).await?;
    vault::open(&keys, &event)
}

#[tauri::command]
fn store_load(store: State<Store>) -> Result<Vec<Value>, String> {
    store.load()
}

#[tauri::command]
fn store_save(
    app: AppHandle,
    store: State<Store>,
    docs: Vec<Value>,
    dirty: bool,
) -> Result<(), String> {
    let docs = store.save(&docs, dirty)?;
    app.emit("store-changed", json!({ "docs": docs }))
        .map_err(|e| e.to_string())
}

/// Tells every window about documents another process (the `stuff` CLI) wrote to the store.
fn watch_store(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(300));
            match app.state::<Store>().external_changes() {
                Ok(docs) if !docs.is_empty() => {
                    let _ = app.emit("store-changed", json!({ "docs": docs }));
                }
                Ok(_) => {}
                Err(e) => eprintln!("store watch: {e}"),
            }
        }
    });
}

#[tauri::command]
fn folder_list(path: PathBuf) -> Result<Vec<folder::Entry>, String> {
    folder::list(&path)
}

#[tauri::command]
fn folder_stat(path: PathBuf, name: String) -> Result<Option<folder::Stat>, String> {
    folder::stat(&path, &name)
}

#[tauri::command]
fn folder_read(path: PathBuf, name: String) -> Result<String, String> {
    folder::read(&path, &name)
}

#[tauri::command]
fn folder_write(path: PathBuf, name: String, text: String) -> Result<folder::Stat, String> {
    folder::write(&path, &name, &text)
}

#[tauri::command]
fn store_dirty(store: State<Store>) -> Result<Vec<Dirty>, String> {
    store.dirty()
}

#[tauri::command]
fn store_clean(store: State<Store>, published: Vec<Published>) -> Result<(), String> {
    store.clean(&published)
}

#[tauri::command]
fn meta_get(store: State<Store>, key: String) -> Result<Option<String>, String> {
    store.meta(&key)
}

#[tauri::command]
fn meta_set(store: State<Store>, key: String, value: String) -> Result<(), String> {
    store.set_meta(&key, &value)
}

#[tauri::command]
async fn things_read(path: PathBuf) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || things::read(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn text_read(path: PathBuf) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn text_write(path: PathBuf, text: String) -> Result<(), String> {
    std::fs::write(path, text).map_err(|e| e.to_string())
}

struct ThemesDir(PathBuf);

#[tauri::command]
fn themes_load(dir: State<ThemesDir>) -> Value {
    json!({ "dir": dir.0, "files": themes::read(&dir.0) })
}

static WINDOWS: AtomicU32 = AtomicU32::new(1);

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    let label = format!("main-{}", WINDOWS.fetch_add(1, Ordering::Relaxed));
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("stuff")
        .inner_size(1000.0, 700.0)
        .min_inner_size(640.0, 420.0)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn new_window(app: AppHandle) -> Result<(), String> {
    main_window(&app).map(|_| ())
}

fn toggle_quick_entry(app: &AppHandle) {
    let Some(window) = app.get_webview_window("quick") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("quick-entry", ());
    }
}

#[tauri::command]
fn quick_entry(app: AppHandle) {
    toggle_quick_entry(&app);
}

fn data_dir(app: &AppHandle) -> tauri::Result<PathBuf> {
    let dir = app.path().app_data_dir()?;
    Ok(match profile() {
        Some(p) => dir.join(p),
        None => dir,
    })
}

pub fn run() {
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, pressed, event| {
                    if pressed == &shortcut && event.state() == ShortcutState::Pressed {
                        toggle_quick_entry(app);
                    }
                })
                .build(),
        )
        .manage(Vault::default())
        .setup(move |app| {
            let path = data_dir(app.handle())?.join("stuff.sqlite");
            app.manage(Store::open(&path)?);
            let themes_dir = data_dir(app.handle())?.join("themes");
            if let Err(e) = themes::prepare(&themes_dir) {
                eprintln!("Themes folder unavailable: {e}");
            }
            let handle = app.handle().clone();
            themes::watch(themes_dir.clone(), std::time::Duration::from_secs(1), move || {
                let _ = handle.emit("themes-changed", ());
            });
            app.manage(ThemesDir(themes_dir));
            watch_store(app.handle().clone());
            if let Err(e) = app.global_shortcut().register(shortcut) {
                eprintln!("Quick Entry shortcut unavailable: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            key_status,
            generate_key,
            import_key,
            seal_object,
            open_object,
            store_load,
            store_save,
            store_dirty,
            store_clean,
            meta_get,
            meta_set,
            things_read,
            text_read,
            text_write,
            themes_load,
            folder_list,
            folder_stat,
            folder_read,
            folder_write,
            new_window,
            quick_entry
        ])
        .build(tauri::generate_context!())
        .expect("error while building stuff")
        .run(|app, event| {
            if let RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                let _ = main_window(app);
            }
        });
}
