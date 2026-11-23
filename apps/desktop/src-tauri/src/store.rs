//! The local store: one SQLite file of documents (JSON) with a dirty flag for sync.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub struct Store {
    conn: Mutex<Connection>,
    /// `data_version` and the highest revision already seen, to notice other processes' writes.
    seen: Mutex<(i64, i64)>,
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
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(err)?;
        conn.pragma_update(None, "journal_mode", "WAL").map_err(err)?;
        conn.execute_batch(SCHEMA).map_err(err)?;
        let seen = (data_version(&conn)?, max_rev(&conn)?);
        Ok(Self {
            conn: Mutex::new(conn),
            seen: Mutex::new(seen),
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

    /// Writes documents merged per field with the stored ones (another process may have written
    /// newer fields); `dirty` marks them for publishing. Every write bumps the row's revision.
    pub fn save(&self, docs: &[Value], dirty: bool) -> Result<Vec<Value>, String> {
        let mut conn = self.conn.lock().unwrap();
        let before = data_version(&conn)?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let rev = max_rev(&tx)? + 1;
        let mut out = Vec::with_capacity(docs.len());
        for doc in docs {
            let id = doc["id"].as_str().ok_or("A document has no id")?;
            let stored: Option<String> = tx
                .query_row("SELECT doc FROM objects WHERE id = ?1", [id], |r| r.get(0))
                .optional()
                .map_err(err)?;
            let merged = match stored {
                Some(s) => merge(&serde_json::from_str(&s).map_err(err)?, doc),
                None => doc.clone(),
            };
            tx.execute(
                "INSERT INTO objects (id, doc, dirty, rev) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET doc = ?2, dirty = ?3, rev = ?4",
                params![id, merged.to_string(), dirty, rev],
            )
            .map_err(err)?;
            out.push(merged);
        }
        tx.commit().map_err(err)?;
        let mut seen = self.seen.lock().unwrap();
        if seen.0 == before && data_version(&conn)? == before {
            seen.1 = rev;
        }
        Ok(out)
    }

    /// Documents another process (the CLI) wrote since the last call; empty when there are none.
    pub fn external_changes(&self) -> Result<Vec<Value>, String> {
        let conn = self.conn.lock().unwrap();
        let mut seen = self.seen.lock().unwrap();
        let version = data_version(&conn)?;
        if version == seen.0 {
            return Ok(vec![]);
        }
        let mut stmt = conn
            .prepare("SELECT doc, rev FROM objects WHERE rev > ?1")
            .map_err(err)?;
        let rows = stmt
            .query_map([seen.1], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(err)?;
        let mut docs = vec![];
        let mut top = seen.1;
        for row in rows {
            let (doc, rev) = row.map_err(err)?;
            top = top.max(rev);
            docs.push(serde_json::from_str(&doc).map_err(err)?);
        }
        *seen = (version, top);
        Ok(docs)
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

fn data_version(conn: &Connection) -> Result<i64, String> {
    conn.query_row("PRAGMA data_version", [], |r| r.get(0))
        .map_err(err)
}

fn max_rev(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT COALESCE(MAX(rev), 0) FROM objects", [], |r| r.get(0))
        .map_err(err)
}

/// Per-field last-writer-wins by HLC stamp with sticky deletion, like `merge` in `core/doc.ts`.
fn merge(local: &Value, remote: &Value) -> Value {
    let mut out = local.clone();
    if let (Some(ours), Some(theirs)) = (out["f"].as_object_mut(), remote["f"].as_object()) {
        for (key, field) in theirs {
            if ours
                .get(key)
                .is_none_or(|o| field["c"].as_str() > o["c"].as_str())
            {
                ours.insert(key.clone(), field.clone());
            }
        }
    }
    if remote["deleted"] == Value::Bool(true) {
        out["deleted"] = Value::Bool(true);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc(id: &str, fields: Value) -> Value {
        json!({"id": id, "type": "todo", "f": fields})
    }

    #[test]
    fn merges_each_field_with_what_another_writer_stored() {
        let store = Store::memory();
        let title = |v: &str, c: &str| json!({"v": v, "c": c});
        store.save(&[doc("a", json!({"title": title("Milk", "1")}))], true).unwrap();
        let stale = doc("a", json!({"title": title("Milk", "1"), "notes": title("2 l", "3")}));
        store.save(&[doc("a", json!({"title": title("Oat milk", "2")}))], true).unwrap();
        let expected = doc("a", json!({"title": title("Oat milk", "2"), "notes": title("2 l", "3")}));
        assert_eq!(store.save(&[stale], true).unwrap(), vec![expected.clone()]);
        assert_eq!(store.load().unwrap(), vec![expected]);

        let mut gone = doc("a", json!({}));
        gone["deleted"] = json!(true);
        store.save(&[gone], true).unwrap();
        store.save(&[doc("a", json!({}))], true).unwrap();
        assert_eq!(store.load().unwrap()[0]["deleted"], json!(true));
    }

    #[test]
    fn notices_documents_another_process_wrote() {
        let dir = std::env::temp_dir().join(format!("stuff-store-{}", std::process::id()));
        let path = dir.join("stuff.sqlite");
        let app = Store::open(&path).unwrap();
        let cli = Store::open(&path).unwrap();
        app.save(&[doc("mine", json!({}))], true).unwrap();
        assert!(app.external_changes().unwrap().is_empty());
        cli.save(&[doc("theirs", json!({}))], true).unwrap();
        let seen = app.external_changes().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0]["id"], "theirs");
        assert!(app.external_changes().unwrap().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn saves_loads_and_replaces_documents() {
        let store = Store::memory();
        let v = |n: u8| doc("a", json!({"v": {"v": n, "c": n.to_string()}}));
        store.save(&[v(1), doc("b", json!({}))], true).unwrap();
        store.save(&[v(2)], false).unwrap();
        let mut docs = store.load().unwrap();
        docs.sort_by_key(|d| d["id"].as_str().unwrap().to_string());
        assert_eq!(docs, vec![v(2), doc("b", json!({}))]);
        assert!(store.save(&[json!({"v": 1})], true).is_err());
    }

    #[test]
    fn keeps_a_document_dirty_when_it_changed_while_publishing() {
        let store = Store::memory();
        let v = |n: u8| doc("a", json!({"v": {"v": n, "c": n.to_string()}}));
        store.save(&[v(1), doc("b", json!({}))], true).unwrap();
        let dirty = store.dirty().unwrap();
        assert_eq!(dirty.len(), 2);
        store.save(&[v(2)], true).unwrap();
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
        assert_eq!(left[0].doc, v(2));
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
