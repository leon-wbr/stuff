import { dayOf } from "@stuff/core/days";
import type { World } from "@stuff/core/lists";
import type { Id } from "@stuff/core/model";
import { thingsUrl } from "@stuff/core/thingsUrl";
import { openUrl } from "@tauri-apps/plugin-opener";

export const sendToThings = (w: World, ids: Id[]) =>
  ids.length && openUrl(thingsUrl(w, ids, dayOf(new Date()))).catch((e) => console.error(e));
