import { dueReminders } from "@stuff/core/reminders";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useEffect, useRef } from "react";
import { isPrimary, useWorld } from "./app.ts";

/** Local notifications for reminders, from the primary window only. */
export function useReminders() {
  const w = useWorld();
  const latest = useRef(w);
  latest.current = w;
  useEffect(() => {
    if (!isPrimary) return;
    let last = Date.now();
    const check = async () => {
      const now = Date.now();
      const due = dueReminders(latest.current, last, now);
      last = now;
      if (!due.length) return;
      if (!(await isPermissionGranted()) && (await requestPermission()) !== "granted") return;
      for (const t of due)
        sendNotification({ title: t.title || "To-do", body: t.notes.split("\n")[0] || undefined });
    };
    const timer = setInterval(() => void check(), 20_000);
    return () => clearInterval(timer);
  }, []);
}
