//! The local store: one SQLite file of documents (JSON) with a dirty flag for sync.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub struct Store {
    conn: Mutex<Connection>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct Dirty {
    pub doc: Value,
    pub rev: i64,
}

#[derive(Deserialize)]
pub struct Published {
    pub id: String,
    pub rev: i64,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, doc TEXT NOT NULL, dirty INTEGER NOT NULL, rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
";

fn err(e: impl ToString) -> String {
    e.to_string()
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(err)?;
        }
        Self::with(Connection::open(path).map_err(err)?)
    }

    #[cfg(test)]
    pub fn memory() -> Self {
        Self::with(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn with(conn: Connection) -> Result<Self, String> {
        conn.execute_batch(SCHEMA).map_err(err)?;
        conn.pragma_update(None, "journal_mode", "WAL").map_err(err)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn load(&self) -> Result<Vec<Value>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT doc FROM objects").map_err(err)?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?;
        rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
            .collect()
    }

    /// Writes documents; `dirty` marks them for publishing. Every write bumps the row's revision.
    pub fn save(&self, docs: &[Value], dirty: bool) -> Result<(), String> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction().map_err(err)?;
        let rev: i64 = tx
            .query_row("SELECT COALESCE(MAX(rev), 0) + 1 FROM objects", [], |r| r.get(0))
            .map_err(err)?;
        for doc in docs {
            let id = doc["id"].as_str().ok_or("A document has no id")?;
            tx.execute(
                "INSERT INTO objects (id, doc, dirty, rev) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET doc = ?2, dirty = ?3, rev = ?4",
                params![id, doc.to_string(), dirty, rev],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }

    pub fn dirty(&self) -> Result<Vec<Dirty>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT doc, rev FROM objects WHERE dirty = 1")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(err)?;
        rows.map(|r| {
            let (doc, rev) = r.map_err(err)?;
            Ok(Dirty {
                doc: serde_json::from_str(&doc).map_err(err)?,
                rev,
            })
        })
        .collect()
    }

    /// Clears the dirty flag of documents that weren't written again since they were published.
    pub fn clean(&self, published: &[Published]) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        for p in published {
            conn.execute(
                "UPDATE objects SET dirty = 0 WHERE id = ?1 AND rev = ?2",
                params![p.id, p.rev],
            )
            .map_err(err)?;
        }
        Ok(())
    }

    pub fn meta(&self, key: &str) -> Result<Option<String>, String> {
        self.conn
            .lock()
            .unwrap()
            .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
            .optional()
            .map_err(err)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
                [key, value],
            )
            .map(|_| ())
            .map_err(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn saves_loads_and_replaces_documents() {
        let store = Store::memory();
        store.save(&[json!({"id": "a", "v": 1}), json!({"id": "b"})], true).unwrap();
        store.save(&[json!({"id": "a", "v": 2})], false).unwrap();
        let mut docs = store.load().unwrap();
        docs.sort_by_key(|d| d["id"].as_str().unwrap().to_string());
        assert_eq!(docs, vec![json!({"id": "a", "v": 2}), json!({"id": "b"})]);
        assert!(store.save(&[json!({"v": 1})], true).is_err());
    }

    #[test]
    fn keeps_a_document_dirty_when_it_changed_while_publishing() {
        let store = Store::memory();
        store.save(&[json!({"id": "a", "v": 1}), json!({"id": "b"})], true).unwrap();
        let dirty = store.dirty().unwrap();
        assert_eq!(dirty.len(), 2);
        store.save(&[json!({"id": "a", "v": 2})], true).unwrap();
        let published: Vec<Published> = dirty
            .iter()
            .map(|d| Published {
                id: d.doc["id"].as_str().unwrap().into(),
                rev: d.rev,
            })
            .collect();
        store.clean(&published).unwrap();
        let left = store.dirty().unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].doc, json!({"id": "a", "v": 2}));
    }

    #[test]
    fn stores_meta_values() {
        let store = Store::memory();
        assert_eq!(store.meta("lastSync").unwrap(), None);
        store.set_meta("lastSync", "10").unwrap();
        store.set_meta("lastSync", "20").unwrap();
        assert_eq!(store.meta("lastSync").unwrap().as_deref(), Some("20"));
    }
}
