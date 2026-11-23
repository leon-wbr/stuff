import { DatabaseSync } from "node:sqlite";
import type { ThingsData } from "./things";

/** The Things 3 tables stuff reads, with the column names of a current Things database. */
const SCHEMA = `
CREATE TABLE TMArea (uuid TEXT PRIMARY KEY, title TEXT, visible INTEGER, "index" INTEGER, cachedTags BLOB, experimental BLOB);
CREATE TABLE TMTag (uuid TEXT PRIMARY KEY, title TEXT, shortcut TEXT, usedDate REAL, parent TEXT, "index" INTEGER, experimental BLOB);
CREATE TABLE TMTaskTag (tasks TEXT NOT NULL, tags TEXT NOT NULL);
CREATE TABLE TMAreaTag (areas TEXT NOT NULL, tags TEXT NOT NULL);
CREATE TABLE TMChecklistItem (uuid TEXT PRIMARY KEY, userModificationDate REAL, creationDate REAL, title TEXT, status INTEGER, stopDate REAL, "index" INTEGER, task TEXT, leavesTombstone INTEGER, experimental BLOB);
CREATE TABLE TMTask (uuid TEXT PRIMARY KEY, leavesTombstone INTEGER, creationDate REAL, userModificationDate REAL, type INTEGER, status INTEGER, stopDate REAL, trashed INTEGER, title TEXT, notes TEXT, notesSync INTEGER, cachedTags BLOB, start INTEGER, startDate INTEGER, startBucket INTEGER, reminderTime INTEGER, lastReminderInteractionDate REAL, deadline INTEGER, deadlineSuppressionDate INTEGER, t2_deadlineOffset INTEGER, "index" INTEGER, todayIndex INTEGER, todayIndexReferenceDate INTEGER, area TEXT, project TEXT, heading TEXT, contact TEXT, untrashedLeafActionsCount INTEGER, openUntrashedLeafActionsCount INTEGER, checklistItemsCount INTEGER, openChecklistItemsCount INTEGER, rt1_repeatingTemplate TEXT, rt1_recurrenceRule BLOB, rt1_instanceCreationStartDate INTEGER, rt1_instanceCreationPaused INTEGER, rt1_instanceCreationCount INTEGER, rt1_afterCompletionReferenceDate INTEGER, rt1_nextInstanceStartDate INTEGER, experimental BLOB, repeater BLOB, repeaterMigrationDate REAL);
`;

export const pack = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return (y! << 16) | (m! << 12) | (d! << 7);
};

export const rule = (unit: number, amount: number, type: 0 | 1) =>
  `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>fa</key><integer>${amount}</integer><key>fu</key><integer>${unit}</integer><key>tp</key><integer>${type}</integer></dict></plist>`;

type Row = Record<string, string | number | null>;

/** Builds a synthetic Things database in memory and reads it back the way `things.rs` does. */
export function thingsFixture(rows: {
  TMArea?: Row[];
  TMTag?: Row[];
  TMTask?: Row[];
  TMTaskTag?: Row[];
  TMAreaTag?: Row[];
  TMChecklistItem?: Row[];
}): ThingsData {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  for (const [table, list] of Object.entries(rows))
    for (const row of list) {
      const cols = Object.keys(row);
      db.prepare(
        `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      ).run(...Object.values(row));
    }
  const read = (table: string) =>
    db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
  const data = {
    TMTask: read("TMTask"),
    TMArea: read("TMArea"),
    TMTag: read("TMTag"),
    TMTaskTag: read("TMTaskTag"),
    TMAreaTag: read("TMAreaTag"),
    TMChecklistItem: read("TMChecklistItem"),
  };
  db.close();
  return data;
}
