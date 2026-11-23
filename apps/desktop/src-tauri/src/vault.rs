//! Sync events: every object is a kind 30078 event whose content is NIP-44 v2 encrypted to the
//! user's own key. Only this module touches the secret key's crypto; the webview gets sealed
//! events and plaintext of its own objects, nothing else.

use nostr::nips::nip44;
use nostr::prelude::{Event, FinalizeEvent, Keys, UnsignedEvent};
use serde_json::json;

pub const KIND: u16 = 30078;
pub const APP_TAG: &str = "stuff";

pub fn seal(keys: &Keys, id: &str, plaintext: &str, created_at: u64) -> Result<Event, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Object ids are alphanumeric".into());
    }
    let pubkey = keys.public_key();
    let content = nip44::encrypt(keys.secret_key(), &pubkey, plaintext, nip44::Version::V2)
        .map_err(|e| e.to_string())?;
    let unsigned: UnsignedEvent = serde_json::from_value(json!({
        "pubkey": pubkey.to_hex(),
        "kind": KIND,
        "content": content,
        "tags": [["d", id], ["t", APP_TAG]],
        "created_at": created_at,
    }))
    .map_err(|e| e.to_string())?;
    unsigned.finalize(keys).map_err(|e| e.to_string())
}

/// Checks the event is a valid stuff object signed by this key and returns its plaintext.
pub fn open(keys: &Keys, event: &Event) -> Result<String, String> {
    event.verify().map_err(|e| e.to_string())?;
    if event.pubkey != keys.public_key() || event.kind.as_u16() != KIND {
        return Err("Not one of your objects".into());
    }
    nip44::decrypt(keys.secret_key(), &event.pubkey, &event.content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = r#"{"id":"abc123","type":"todo","f":{"title":{"v":"Buy milk","c":"1"}}}"#;

    #[test]
    fn seals_an_encrypted_signed_replaceable_event() {
        let keys = Keys::generate();
        let event = seal(&keys, "abc123", DOC, 1_790_000_000).unwrap();
        assert!(event.verify().is_ok());
        assert_eq!(event.kind.as_u16(), 30078);
        assert_eq!(event.pubkey, keys.public_key());
        assert!(!event.content.contains("milk"));
        let tags: Vec<Vec<String>> = event.tags.iter().map(|t| t.clone().to_vec()).collect();
        assert_eq!(tags, vec![vec!["d", "abc123"], vec!["t", "stuff"]]);
        assert_eq!(open(&keys, &event).unwrap(), DOC);
    }

    #[test]
    fn opens_only_its_own_untampered_objects() {
        let keys = Keys::generate();
        let other = Keys::generate();
        let theirs = seal(&other, "abc123", DOC, 1).unwrap();
        assert!(open(&keys, &theirs).is_err());

        let mut tampered = serde_json::to_value(seal(&keys, "abc123", DOC, 1).unwrap()).unwrap();
        tampered["content"] = json!(seal(&keys, "abc123", "{}", 1).unwrap().content);
        let tampered: Event = serde_json::from_value(tampered).unwrap();
        assert!(open(&keys, &tampered).is_err());
    }

    /// Sealed by nostr-tools (the webview's library) with a throwaway test key.
    #[test]
    fn opens_events_sealed_by_nostr_tools() {
        let keys =
            Keys::parse("7f4c11a9742721d66e40e321ca50b682c27f7422190c14a187525e69e604836a")
                .unwrap();
        let event: Event = serde_json::from_str(r#"{"kind":30078,"created_at":1790000000,"tags":[["d","abc123"],["t","stuff"]],"content":"AlO3/3g3Nx7j1XAvGUldsEjdUas4gttDqI04+UZe/nesuInSfsvfM+bGRzd8fFYL7FmD1ZsABq6UiQWzurCCY7AcN56ORxO1ZXaZ8wgcBvVbNud7Nh3Vq3pJ3U3eirzeJeoSFbiBUWZdvjYQ2rzJNRdPAc0+nOXbZniObccLXaBQbbz/AmlZuarpWdU7tJkwQ8PrxlE1Dj0HJ9Mu5VAP2dWDRw==","pubkey":"7cef86754ddf07395c289c30fe31219de938c6d707d6b478a8682fc75795e8b9","id":"3d602f19499c7c840ede475e21ff0de94b855c1d25acc88088566f7865cf45f6","sig":"36e368ab00b0891148b0c9958c7d3ee8f9a3110842d11db77a1e989697f5cee616401810816ef11353831250c61c2955e5de11528cfc2f55ff949cd9aeb5d827"}"#).unwrap();
        assert_eq!(
            open(&keys, &event).unwrap(),
            r#"{"id":"abc123","type":"todo","f":{"title":{"v":"From TS","c":"1"}}}"#
        );
    }

    #[test]
    fn refuses_ids_that_could_smuggle_tags() {
        let keys = Keys::generate();
        assert!(seal(&keys, "", DOC, 1).is_err());
        assert!(seal(&keys, "a\",\"b", DOC, 1).is_err());
    }
}
