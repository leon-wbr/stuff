//! The themes folder: user theme files (`*.json`) that the frontend parses and validates.
//! Rust only lists, reads and watches them.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

pub const SCHEMA_FILE: &str = "theme.schema.json";
const SCHEMA: &str = include_str!("../../../../packages/ui/themes/theme.schema.json");
const MAX_BYTES: u64 = 256 * 1024;

#[derive(Debug, Serialize, PartialEq)]
pub struct ThemeFile {
    pub file: String,
    pub text: String,
}

fn theme_paths(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return vec![];
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.ends_with(".json") && !name.ends_with(".schema.json") && !name.starts_with('.')
        })
        .collect();
    paths.sort();
    paths
}

/// Creates the folder and (re)writes the JSON Schema next to the theme files.
pub fn prepare(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join(SCHEMA_FILE), SCHEMA)
}

/// Every theme file's text; unreadable or oversized files are left out.
pub fn read(dir: &Path) -> Vec<ThemeFile> {
    theme_paths(dir)
        .into_iter()
        .filter(|p| p.metadata().is_ok_and(|m| m.is_file() && m.len() <= MAX_BYTES))
        .filter_map(|p| {
            let text = std::fs::read_to_string(&p).ok()?;
            Some(ThemeFile { file: p.file_name()?.to_string_lossy().into_owned(), text })
        })
        .collect()
}

type Fingerprint = Vec<(PathBuf, Option<SystemTime>, u64)>;

fn fingerprint(dir: &Path) -> Fingerprint {
    theme_paths(dir)
        .into_iter()
        .map(|p| {
            let meta = p.metadata().ok();
            let modified = meta.as_ref().and_then(|m| m.modified().ok());
            let len = meta.map_or(0, |m| m.len());
            (p, modified, len)
        })
        .collect()
}

/// Calls `on_change` from a background thread whenever a theme file is added, removed or edited.
pub fn watch(dir: PathBuf, every: Duration, on_change: impl Fn() + Send + 'static) {
    std::thread::spawn(move || {
        let mut last = fingerprint(&dir);
        loop {
            std::thread::sleep(every);
            let now = fingerprint(&dir);
            if now != last {
                last = now;
                on_change();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("stuff-themes-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn prepare_writes_the_schema_which_read_skips() {
        let dir = temp_dir("prepare");
        prepare(&dir).unwrap();
        assert!(std::fs::read_to_string(dir.join(SCHEMA_FILE)).unwrap().contains("\"name\""));
        assert_eq!(read(&dir), vec![]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reads_json_files_in_name_order_and_skips_the_rest() {
        let dir = temp_dir("read");
        prepare(&dir).unwrap();
        std::fs::write(dir.join("b.json"), "{\"name\":\"B\"}").unwrap();
        std::fs::write(dir.join("a.json"), "{\"name\":\"A\"}").unwrap();
        std::fs::write(dir.join("notes.txt"), "hi").unwrap();
        std::fs::write(dir.join("big.json"), "x".repeat(MAX_BYTES as usize + 1)).unwrap();
        std::fs::create_dir(dir.join("folder.json")).unwrap();
        let files: Vec<_> = read(&dir).into_iter().map(|f| f.file).collect();
        assert_eq!(files, ["a.json", "b.json"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_folder_reads_as_empty() {
        assert_eq!(read(&temp_dir("missing")), vec![]);
    }

    #[test]
    fn watch_reports_added_edited_and_removed_files() {
        let dir = temp_dir("watch");
        prepare(&dir).unwrap();
        let (tx, rx) = mpsc::channel();
        watch(dir.clone(), Duration::from_millis(20), move || {
            let _ = tx.send(());
        });
        let wait = || rx.recv_timeout(Duration::from_secs(2)).expect("change noticed");
        std::thread::sleep(Duration::from_millis(50));
        std::fs::write(dir.join("t.json"), "{}").unwrap();
        wait();
        std::fs::write(dir.join("t.json"), "{\"name\":\"T\"}").unwrap();
        wait();
        std::fs::remove_file(dir.join("t.json")).unwrap();
        wait();
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
