export type Command =
  | "newTodo"
  | "newTodoBelow"
  | "newProject"
  | "newHeading"
  | "newWindow"
  | "complete"
  | "cancel"
  | "today"
  | "evening"
  | "anytime"
  | "someday"
  | "when"
  | "deadline"
  | "move"
  | "tags"
  | "checklist"
  | "duplicate"
  | "trash"
  | "open"
  | "close"
  | "up"
  | "down"
  | "extendUp"
  | "extendDown"
  | "moveUp"
  | "moveDown"
  | "find"
  | "sendToThings"
  | "repeat"
  | "undo"
  | "redo"
  | "toggleSidebar"
  | `go:${number}`;

/** Things-style shortcuts. `Mod` is Cmd on macOS. */
export const SHORTCUTS: Record<string, Command> = {
  "Mod+N": "newTodo",
  " ": "newTodoBelow",
  "Mod+Alt+N": "newProject",
  "Mod+Shift+N": "newHeading",
  "Mod+Ctrl+N": "newWindow",
  "Mod+K": "complete",
  "Mod+Alt+K": "cancel",
  "Mod+T": "today",
  "Mod+E": "evening",
  "Mod+R": "anytime",
  "Mod+O": "someday",
  "Mod+S": "when",
  "Mod+Shift+D": "deadline",
  "Mod+Shift+M": "move",
  "Mod+Shift+T": "tags",
  "Mod+Shift+C": "checklist",
  "Mod+D": "duplicate",
  Backspace: "trash",
  Delete: "trash",
  Enter: "open",
  Escape: "close",
  ArrowUp: "up",
  ArrowDown: "down",
  "Shift+ArrowUp": "extendUp",
  "Shift+ArrowDown": "extendDown",
  "Mod+ArrowUp": "moveUp",
  "Mod+ArrowDown": "moveDown",
  "Mod+F": "find",
  "Mod+Shift+S": "sendToThings",
  "Mod+Shift+R": "repeat",
  "Mod+Z": "undo",
  "Mod+Shift+Z": "redo",
  "Mod+Ctrl+S": "toggleSidebar",
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`Mod+${n}`, `go:${n}` as const])),
};

const GLYPHS: Record<string, string> = {
  Mod: "⌘",
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Backspace: "⌫",
  Delete: "⌦",
  Enter: "↩",
  Escape: "⎋",
  ArrowUp: "↑",
  ArrowDown: "↓",
  " ": "Space",
};

/** The first shortcut bound to `command`, as a Mac menu shows it (⌃⌥⇧⌘ order), e.g. "⇧⌘M". */
export function shortcutLabel(command: Command): string | undefined {
  const keys = Object.keys(SHORTCUTS).find((k) => SHORTCUTS[k] === command);
  if (keys === undefined) return;
  const parts = keys === " " ? [" "] : keys.split("+");
  const key = parts.pop()!;
  const mods = ["Ctrl", "Alt", "Shift", "Mod"].filter((m) => parts.includes(m));
  return [...mods, key].map((p) => GLYPHS[p] ?? p).join("");
}

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** The physical key, used where Alt changes the character (Alt+N types "˜" on a Mac). */
  code?: string;
}

export function combo(e: KeyLike): string {
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (e.code?.startsWith("Key")) key = e.code.slice(3);
  else if (e.code?.startsWith("Digit")) key = e.code.slice(5);
  if (key === " " && (e.metaKey || e.ctrlKey || e.altKey)) key = "Space";
  return [e.metaKey && "Mod", e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", key]
    .filter(Boolean)
    .join("+");
}

export const commandFor = (e: KeyLike): Command | undefined => SHORTCUTS[combo(e)];

/** A printable key with no modifiers starts Type Travel (Quick Find with that letter). */
export const startsTypeTravel = (e: KeyLike) =>
  e.key.length === 1 && e.key !== " " && !e.metaKey && !e.ctrlKey && !e.altKey;
