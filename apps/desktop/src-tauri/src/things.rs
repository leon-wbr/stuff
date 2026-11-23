//! Reads a Things 3 database (`main.sqlite`) strictly read-only and returns its tables as JSON
//! rows; `core/things.ts` maps them into stuff's model.

use std::path::Path;

use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde_json::{Map, Value, json};

const TABLES: [&str; 6] = [
    "TMTask",
    "TMArea",
    "TMTag",
    "TMTaskTag",
    "TMAreaTag",
    "TMChecklistItem",
];

/// An immutable, read-only URI: SQLite won't create -wal/-shm files or take locks next to it.
fn uri(path: &Path) -> String {
    let mut out = String::from("file:");
    for c in path.to_string_lossy().chars() {
        match c {
            '%' => out.push_str("%25"),
            ' ' => out.push_str("%20"),
            '?' => out.push_str("%3f"),
            '#' => out.push_str("%23"),
            c => out.push(c),
        }
    }
    out + "?mode=ro&immutable=1"
}

fn cell(value: ValueRef) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) | ValueRef::Blob(t) => json!(String::from_utf8_lossy(t)),
    }
}

fn table(conn: &Connection, name: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(&format!("SELECT * FROM \"{name}\""))
        .map_err(|e| format!("This doesn't look like a Things database ({e})"))?;
    let columns: Vec<String> = stmt.column_names().map(|c| c.to_string()).collect();
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut object = Map::new();
        for (i, column) in columns.iter().enumerate() {
            object.insert(column.clone(), cell(row.get_ref(i).map_err(|e| e.to_string())?));
        }
        out.push(Value::Object(object));
    }
    Ok(out)
}

pub fn read(path: &Path) -> Result<Value, String> {
    let conn = Connection::open_with_flags(
        uri(path),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| e.to_string())?;
    let mut out = Map::new();
    for name in TABLES {
        out.insert(name.into(), Value::Array(table(&conn, name)?));
    }
    Ok(Value::Object(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("main.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE TMTask (uuid TEXT PRIMARY KEY, type INTEGER, title TEXT, startDate INTEGER, rt1_recurrenceRule BLOB);
             CREATE TABLE TMArea (uuid TEXT PRIMARY KEY, title TEXT, 'index' INTEGER);
             CREATE TABLE TMTag (uuid TEXT PRIMARY KEY, title TEXT, parent TEXT);
             CREATE TABLE TMTaskTag (tasks TEXT, tags TEXT);
             CREATE TABLE TMAreaTag (areas TEXT, tags TEXT);
             CREATE TABLE TMChecklistItem (uuid TEXT PRIMARY KEY, title TEXT, task TEXT, stopDate REAL);
             INSERT INTO TMTask VALUES ('t1', 0, 'Synthetic task', 132821120, CAST('<plist/>' AS BLOB));
             INSERT INTO TMArea VALUES ('a1', 'Synthetic area', 3);
             INSERT INTO TMChecklistItem VALUES ('c1', 'step', 't1', 1700000000.5);",
        )
        .unwrap();
        path
    }

    #[test]
    fn reads_every_table_as_json_rows() {
        let dir = std::env::temp_dir().join(format!("stuff things {}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let data = read(&fixture(&dir)).unwrap();
        assert_eq!(
            data["TMTask"][0],
            json!({"uuid": "t1", "type": 0, "title": "Synthetic task", "startDate": 132821120, "rt1_recurrenceRule": "<plist/>"})
        );
        assert_eq!(data["TMArea"][0]["index"], 3);
        assert_eq!(data["TMChecklistItem"][0]["stopDate"], 1700000000.5);
        assert_eq!(data["TMTag"], json!([]));
        let files: Vec<_> = std::fs::read_dir(&dir).unwrap().collect();
        assert_eq!(files.len(), 1, "reading must not leave -wal or -shm files");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_files_that_are_not_things_databases() {
        let dir = std::env::temp_dir().join(format!("stuff-notthings-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("other.sqlite");
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE x (a)")
            .unwrap();
        assert!(read(&path).unwrap_err().contains("Things database"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
