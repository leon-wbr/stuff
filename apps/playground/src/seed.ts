import { addDays, dayOf } from "@stuff/core/days";
import type { Doc } from "@stuff/core/doc";
import { hlc } from "@stuff/core/hlc";
import * as ops from "@stuff/core/ops";
import { makeRepeating } from "@stuff/core/repeat";

/** A synthetic to-do world built with the real ops, so every view has something to show. */
export function seed(theme: "light" | "dark"): Doc[] {
  const today = dayOf(new Date());
  let n = 0;
  const ctx: ops.Ctx = {
    docs: new Map(),
    clock: hlc("seed", () => Date.now()),
    id: () => `seed${String(++n).padStart(4, "0")}`,
    now: Date.now(),
    today,
  };
  const run = (op: ops.Op) => {
    const docs = op(ctx);
    for (const d of docs) ctx.docs.set(d.id, d);
    return docs[0]!.id;
  };
  run(ops.saveSettings({ theme }));
  const home = run(ops.add("area", { title: "Home" }));
  const work = run(ops.add("area", { title: "Work" }));
  const errand = run(ops.add("tag", { title: "Errand" }));
  const calls = run(ops.add("tag", { title: "Calls" }));
  run(ops.add("tag", { title: "Phone", parent: calls }));
  const kitchen = run(
    ops.add(
      "project",
      {
        title: "Kitchen refresh",
        notes: "Paint, shelves and **new lights** before the holidays.",
        deadline: addDays(today, 12),
      },
      `area:${home}`,
    ),
  );
  const plan = run(ops.add("heading", { title: "Planning", project: kitchen }));
  const build = run(ops.add("heading", { title: "Build", project: kitchen }));
  run(
    ops.add("todo", { title: "Measure the wall for shelves", start: "anytime" }, `heading:${plan}`),
  );
  run(
    ops.add(
      "todo",
      { title: "Pick a paint colour", start: "anytime", tags: [errand] },
      `heading:${plan}`,
    ),
  );
  run(
    ops.setStatus(
      [
        run(
          ops.add("todo", { title: "Clear the counters", start: "anytime" }, `project:${kitchen}`),
        ),
      ],
      "completed",
    ),
  );
  const lights = run(
    ops.add(
      "todo",
      { title: "Install the pendant lights", start: "anytime", notes: "Ask about dimmers." },
      `heading:${build}`,
    ),
  );
  run(ops.add("checklist", { title: "Buy bulbs", todo: lights }));
  run(ops.add("checklist", { title: "Turn off the breaker", todo: lights, done: true }));
  run(
    ops.add(
      "todo",
      { title: "Fit the shelf brackets", start: "anytime", deadline: addDays(today, 1) },
      `heading:${build}`,
    ),
  );
  const report = run(ops.add("project", { title: "Quarterly report" }, `area:${work}`));
  run(
    ops.add(
      "todo",
      { title: "Draft the summary", deadline: addDays(today, 2) },
      `project:${report}`,
    ),
  );
  run(
    ops.moveTo(
      [run(ops.add("todo", { title: "Collect the numbers" }, `project:${report}`))],
      "today",
    ),
  );
  run(ops.add("project", { title: "Learn the cello" }, "someday"));
  run(ops.add("todo", { title: "Book a dentist appointment", tags: [calls] }, "inbox"));
  run(ops.add("todo", { title: "Return the library books", deadline: today }, "inbox"));
  run(ops.add("todo", { title: "Compare bike insurance", notes: "Two quotes so far." }, "inbox"));
  run(ops.add("todo", { title: "Reply to the landlord", notes: "About the heating" }, "today"));
  run(ops.add("todo", { title: "Water the plants", reminder: "09:00" }, "today"));
  run(ops.add("todo", { title: "Pick up the dry cleaning", tags: [errand] }, "today"));
  run(ops.add("todo", { title: "Call grandma", tags: [calls] }, "evening"));
  run(ops.add("todo", { title: "Plan the weekend hike" }, `day:${addDays(today, 2)}`));
  run(ops.add("todo", { title: "Renew the passport" }, `day:${addDays(today, 40)}`));
  run(ops.add("todo", { title: "Look into a sailing course" }, "someday"));
  run(
    makeRepeating(run(ops.add("todo", { title: "Pay rent" }, `day:${addDays(today, 5)}`)), {
      mode: "schedule",
      every: 1,
      unit: "month",
    }),
  );
  run(ops.add("todo", { title: "Buy oat milk", start: "anytime" }, `area:${home}`));
  return [...ctx.docs.values()];
}
