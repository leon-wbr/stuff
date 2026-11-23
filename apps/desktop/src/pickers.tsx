import {
  ArchiveIcon,
  BellIcon,
  CalendarBlankIcon,
  CheckIcon,
  CubeIcon,
  MoonIcon,
  PlusIcon,
  StarIcon,
  TrayIcon,
  XIcon,
} from "@phosphor-icons/react";
import { addDays } from "@stuff/core/days";
import { update } from "@stuff/core/doc";
import type { Task } from "@stuff/core/lists";
import type { Id, Repeat, Todo, Unit } from "@stuff/core/model";
import { chain } from "@stuff/core/actions";
import { add, moveTo, set, type Where } from "@stuff/core/ops";
import { setRepeat, stopRepeating } from "@stuff/core/repeat";
import { Button } from "@stuff/ui/components/button";
import { Input } from "@stuff/ui/components/input";
import { useState, type ReactNode } from "react";
import { Stuff, useChange, useWorld } from "./app.ts";
import { ProgressRing } from "./icons.tsx";

function Choice({
  icon,
  children,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      {icon}
      <span className="flex-1">{children}</span>
    </button>
  );
}

/** When: Today, This Evening, a date (with an optional reminder), Someday, or no date. */
export function WhenPicker({ ids, done }: { ids: Id[]; done(): void }) {
  const change = useChange();
  const today = Stuff.useSelector((s) => s.context.today);
  const w = useWorld();
  const first = w.byId.get(ids[0] ?? "") as Task | undefined;
  const [date, setDate] = useState(first?.when ?? addDays(today, 1));
  const [reminder, setReminder] = useState(first?.type === "todo" ? (first.reminder ?? "") : "");
  const go = (where: Where) => {
    change(moveTo(ids, where));
    done();
  };
  const filed = (id: Id) => {
    const t = w.byId.get(id) as Task | undefined;
    return !!t && (t.area || (t.type === "todo" && t.project));
  };
  return (
    <div className="flex flex-col gap-0.5 text-[13px]">
      <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">When</p>
      <Choice
        icon={<StarIcon weight="fill" className="size-4 text-today" />}
        onClick={() => go("today")}
      >
        Today
      </Choice>
      <Choice
        icon={<MoonIcon weight="fill" className="size-4 text-evening" />}
        onClick={() => go("evening")}
      >
        This Evening
      </Choice>
      <Choice
        icon={<CalendarBlankIcon className="size-4 text-muted-foreground" />}
        onClick={() => go(`day:${addDays(today, 1)}`)}
      >
        Tomorrow
      </Choice>
      <Choice icon={<ArchiveIcon className="size-4 text-someday" />} onClick={() => go("someday")}>
        Someday
      </Choice>
      <form
        className="mt-2 flex flex-col gap-2 border-t pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          change(moveTo(ids, `day:${date}`));
          if (first?.type === "todo") change(set(ids, { reminder: reminder || null }));
          done();
        }}
      >
        <label className="flex items-center gap-2 px-2">
          <CalendarBlankIcon className="size-4 text-muted-foreground" />
          <input
            type="date"
            aria-label="Date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 rounded-md bg-muted px-2 py-1"
          />
        </label>
        {first?.type === "todo" && (
          <label className="flex items-center gap-2 px-2">
            <BellIcon className="size-4 text-muted-foreground" />
            <input
              type="time"
              aria-label="Reminder"
              value={reminder}
              onChange={(e) => setReminder(e.target.value)}
              className="flex-1 rounded-md bg-muted px-2 py-1"
            />
          </label>
        )}
        <Button type="submit" size="sm" disabled={!date}>
          Set date
        </Button>
      </form>
      <button
        type="button"
        className="mt-1 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent"
        onClick={() => {
          for (const id of ids) change(moveTo([id], filed(id) ? "anytime" : "inbox"));
          change(
            set(
              ids.filter((id) => w.byId.get(id)?.type === "todo"),
              { reminder: null },
            ),
          );
          done();
        }}
      >
        Clear
      </button>
    </div>
  );
}

export function DeadlinePicker({ ids, done }: { ids: Id[]; done(): void }) {
  const change = useChange();
  const w = useWorld();
  const today = Stuff.useSelector((s) => s.context.today);
  const first = w.byId.get(ids[0] ?? "") as Task | undefined;
  const [date, setDate] = useState(first?.deadline ?? addDays(today, 7));
  return (
    <form
      className="flex flex-col gap-2 text-[13px]"
      onSubmit={(e) => {
        e.preventDefault();
        change(set(ids, { deadline: date || null }));
        done();
      }}
    >
      <p className="text-xs font-medium text-muted-foreground">Deadline</p>
      <input
        type="date"
        aria-label="Deadline"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-md bg-muted px-2 py-1"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="flex-1">
          Set deadline
        </Button>
        {first?.deadline && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              change(set(ids, { deadline: null }));
              done();
            }}
          >
            Clear
          </Button>
        )}
      </div>
    </form>
  );
}

export function MovePicker({ ids, done }: { ids: Id[]; done(): void }) {
  const change = useChange();
  const w = useWorld();
  const projectsMoving = ids.some((id) => w.byId.get(id)?.type === "project");
  const go = (where: Where) => {
    change(moveTo(ids, where));
    done();
  };
  const projects = (area: Id | null) =>
    projectsMoving
      ? []
      : w.projects
          .filter((p) => p.area === area && p.status === "open" && !p.trashed)
          .map((p) => (
            <Choice
              key={p.id}
              icon={<ProgressRing done={0} total={1} />}
              onClick={() => go(`project:${p.id}`)}
            >
              {p.title || "New Project"}
            </Choice>
          ));
  return (
    <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto text-[13px]">
      <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Move to</p>
      {!projectsMoving && (
        <Choice icon={<TrayIcon className="size-4 text-sky-600" />} onClick={() => go("inbox")}>
          Inbox
        </Choice>
      )}
      {projectsMoving && (
        <Choice
          icon={<XIcon className="size-4 text-muted-foreground" />}
          onClick={() => {
            change(set(ids, { area: null }));
            done();
          }}
        >
          No area
        </Choice>
      )}
      {projects(null)}
      {w.areas
        .filter((a) => !a.trashed)
        .map((a) => (
          <div key={a.id}>
            <Choice
              icon={<CubeIcon className="size-4 text-muted-foreground" />}
              onClick={() => go(`area:${a.id}`)}
            >
              <span className="font-medium">{a.title || "New Area"}</span>
            </Choice>
            <div className="pl-3">{projects(a.id)}</div>
          </div>
        ))}
    </div>
  );
}

export function TagPicker({ ids, done }: { ids: Id[]; done(): void }) {
  const change = useChange();
  const w = useWorld();
  const [name, setName] = useState("");
  const items = ids.map((id) => w.byId.get(id)).filter((i): i is Task => !!i && "tags" in i);
  const has = (tag: Id) => items.length > 0 && items.every((i) => i.tags.includes(tag));
  const toggle = (tag: Id) => {
    const on = !has(tag);
    for (const i of items)
      change(
        set([i.id], {
          tags: on ? [...new Set([...i.tags, tag])] : i.tags.filter((t) => t !== tag),
        }),
      );
  };
  const depth = (id: Id | null, d = 0): number => {
    const parent = id ? w.tags.find((t) => t.id === id)?.parent : null;
    return parent && d < 8 ? depth(parent, d + 1) : d;
  };
  return (
    <div className="flex flex-col gap-0.5 text-[13px]">
      <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Tags</p>
      <div className="flex max-h-64 flex-col overflow-y-auto">
        {w.tags.map((t) => (
          <Choice
            key={t.id}
            icon={<CheckIcon className={`size-4 ${has(t.id) ? "text-primary" : "opacity-0"}`} />}
            onClick={() => toggle(t.id)}
          >
            <span style={{ paddingLeft: depth(t.id) * 12 }}>{t.title}</span>
          </Choice>
        ))}
      </div>
      <form
        className="mt-1 flex gap-1.5 border-t pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          const title = name.trim();
          if (!title) return done();
          const existing = w.tags.find((t) => t.title.toLowerCase() === title.toLowerCase());
          if (existing) toggle(existing.id);
          else
            change((ctx) => {
              const [tag] = add("tag", { title })(ctx);
              return [
                tag!,
                ...items.map((i) =>
                  update(ctx.docs.get(i.id)!, { tags: [...i.tags, tag!.id] }, ctx.clock),
                ),
              ];
            });
          setName("");
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New tag"
          className="h-8"
        />
        <Button type="submit" size="icon-sm" variant="secondary" aria-label="Add tag">
          <PlusIcon />
        </Button>
      </form>
    </div>
  );
}

const UNITS: Unit[] = ["day", "week", "month", "year"];

/** A reminder time; a to-do without a date gets Today, since reminders need a day. */
export function ReminderPicker({ ids, done }: { ids: Id[]; done(): void }) {
  const change = useChange();
  const w = useWorld();
  const todos = ids.map((id) => w.byId.get(id)).filter((t): t is Todo => t?.type === "todo");
  const [time, setTime] = useState(todos[0]?.reminder ?? "09:00");
  const save = (reminder: string | null) => {
    const undated = todos.filter((t) => !t.when).map((t) => t.id);
    change(
      chain(
        set(
          todos.map((t) => t.id),
          { reminder },
        ),
        ...(reminder && undated.length ? [moveTo(undated, "today")] : []),
      ),
    );
    done();
  };
  return (
    <form
      className="flex flex-col gap-2 text-[13px]"
      onSubmit={(e) => {
        e.preventDefault();
        save(time || null);
      }}
    >
      <p className="text-xs font-medium text-muted-foreground">Reminder</p>
      <input
        type="time"
        aria-label="Reminder time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        className="rounded-md bg-muted px-2 py-1"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="flex-1">
          Remind me
        </Button>
        {todos.some((t) => t.reminder) && (
          <Button type="button" size="sm" variant="ghost" onClick={() => save(null)}>
            Clear
          </Button>
        )}
      </div>
    </form>
  );
}

/** Edits the rule of a repeating to-do (from its template or an instance) or starts one. */
export function RepeatPicker({ id, done }: { id: Id; done(): void }) {
  const change = useChange();
  const w = useWorld();
  const todo = w.byId.get(id) as Todo | undefined;
  const template = todo?.repeat
    ? todo
    : todo?.template
      ? (w.byId.get(todo.template) as Todo | undefined)
      : undefined;
  const [rule, setRule] = useState<Repeat>(
    template?.repeat ?? { mode: "schedule", every: 1, unit: "week" },
  );
  return (
    <form
      className="flex flex-col gap-2 text-[13px]"
      onSubmit={(e) => {
        e.preventDefault();
        change(setRepeat(id, rule));
        done();
      }}
    >
      <p className="text-xs font-medium text-muted-foreground">Repeat</p>
      <select
        aria-label="Repeat mode"
        value={rule.mode}
        onChange={(e) => setRule({ ...rule, mode: e.target.value as Repeat["mode"] })}
        className="rounded-md bg-muted px-2 py-1"
      >
        <option value="schedule">On a fixed schedule</option>
        <option value="after">After completion</option>
      </select>
      <div className="flex items-center gap-2">
        <span>Every</span>
        <input
          type="number"
          min={1}
          aria-label="Interval"
          value={rule.every}
          onChange={(e) => setRule({ ...rule, every: Math.max(1, Number(e.target.value) || 1) })}
          className="w-14 rounded-md bg-muted px-2 py-1"
        />
        <select
          aria-label="Unit"
          value={rule.unit}
          onChange={(e) => setRule({ ...rule, unit: e.target.value as Unit })}
          className="flex-1 rounded-md bg-muted px-2 py-1"
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
              {rule.every > 1 ? "s" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="flex-1">
          Repeat
        </Button>
        {template && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              change(stopRepeating(id));
              done();
            }}
          >
            Stop
          </Button>
        )}
      </div>
    </form>
  );
}
