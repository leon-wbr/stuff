//! The folder sync adapter's file access: one `<id>.json` per object in a directory the user chose.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct Stat {
    pub mtime: u64,
    pub size: u64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Entry {
    pub name: String,
    #[serde(flatten)]
    pub stat: Stat,
}

fn file(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if name.starts_with('.') || name.contains(['/', '\\']) || !name.ends_with(".json") {
        return Err(format!("{name} isn't an object file"));
    }
    Ok(dir.join(name))
}

fn stat_of(meta: &fs::Metadata) -> Stat {
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64);
    Stat {
        mtime,
        size: meta.len(),
    }
}

fn missing(dir: &Path) -> String {
    format!("The folder {} isn't there", dir.display())
}

pub fn list(dir: &Path) -> Result<Vec<Entry>, String> {
    let mut out = vec![];
    for entry in fs::read_dir(dir).map_err(|_| missing(dir))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if file(dir, &name).is_err() {
            continue;
        }
        if let Some(meta) = entry.metadata().ok().filter(|m| m.is_file()) {
            out.push(Entry {
                name,
                stat: stat_of(&meta),
            });
        }
    }
    Ok(out)
}

pub fn stat(dir: &Path, name: &str) -> Result<Option<Stat>, String> {
    Ok(fs::metadata(file(dir, name)?).ok().map(|m| stat_of(&m)))
}

pub fn read(dir: &Path, name: &str) -> Result<String, String> {
    fs::read_to_string(file(dir, name)?).map_err(|e| e.to_string())
}

/// Writes a temporary dot-file and renames it over the target, so readers never see half a file.
pub fn write(dir: &Path, name: &str, text: &str) -> Result<Stat, String> {
    let target = file(dir, name)?;
    if !dir.is_dir() {
        return Err(missing(dir));
    }
    let tmp = dir.join(format!(".{name}.tmp"));
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    Ok(stat_of(&fs::metadata(&target).map_err(|e| e.to_string())?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_lists_and_reads_object_files_only() {
        let dir = std::env::temp_dir().join(format!("stuff-folder-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let written = write(&dir, "abc.json", "{}").unwrap();
        fs::write(dir.join("notes.txt"), "x").unwrap();
        assert_eq!(written.size, 2);
        assert_eq!(read(&dir, "abc.json").unwrap(), "{}");
        let names: Vec<String> = list(&dir).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["abc.json"]);
        assert_eq!(stat(&dir, "abc.json").unwrap(), Some(written));
        assert_eq!(stat(&dir, "nope.json").unwrap(), None);
        assert!(write(&dir, "../escape.json", "{}").is_err());
        assert!(read(&dir, ".hidden.json").is_err());
        fs::remove_dir_all(&dir).unwrap();
        assert!(list(&dir).unwrap_err().contains("isn't there"));
    }
}
