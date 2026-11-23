import {
  ArrowsClockwiseIcon,
  BellIcon,
  FlagIcon,
  ListChecksIcon,
  MoonIcon,
  NoteIcon,
  StarIcon,
  XIcon,
} from "@phosphor-icons/react";
import { checklistOf, progress, type Task, type World } from "@stuff/core/lists";
import type { Day } from "@stuff/core/model";
import { setStatus } from "@stuff/core/ops";
import { useChange } from "./app.ts";
import { dayLabel, deadlineLabel, stoppedLabel } from "./format.ts";
import { ProgressRing } from "./icons.tsx";

export function Checkbox({
  task,
  onToggle,
  disabled,
}: {
  task: Task;
  onToggle(): void;
  disabled?: boolean;
}) {
  const done = task.status !== "open";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={disabled ? "Repeats on this date" : done ? "Mark as open" : "Complete"}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`grid size-(--checkbox-size) shrink-0 place-items-center rounded-(--checkbox-radius) border-[1.5px] transition-colors ${
        done
          ? "border-checkbox bg-checkbox text-primary-foreground"
          : "border-checkbox-border hover:border-checkbox"
      }`}
    >
      {task.status === "completed" && (
        <svg viewBox="0 0 10 10" className="size-2.5">
          <path
            d="M2 5.2 4.2 7.4 8 2.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {task.status === "canceled" && <XIcon weight="bold" className="size-2.5" />}
    </button>
  );
}

export interface RowProps {
  task: Task;
  w: World;
  today: Day;
  selected: boolean;
  /** Which context the row is shown in, to decide what meta to show. */
  context: "list" | "project" | "today" | "upcoming" | "logbook";
  onSelect(e: React.MouseEvent): void;
  onOpen(): void;
  onDragStart(e: React.DragEvent): void;
}

export function Row({
  task,
  w,
  today,
  selected,
  context,
  onSelect,
  onOpen,
  onDragStart,
}: RowProps) {
  const change = useChange();
  const done = task.status !== "open";
  const checklist = task.type === "todo" ? checklistOf(w, task.id) : [];
  const parent =
    task.type === "todo" && task.project
      ? w.byId.get(task.project)
      : task.area
        ? w.byId.get(task.area)
        : undefined;
  const showWhen =
    context !== "upcoming" &&
    context !== "today" &&
    task.when &&
    task.start === "anytime" &&
    task.when > today;
  const inToday =
    context !== "today" && task.when && task.when <= today && task.start === "anytime" && !done;
  const tags = task.tags.map((id) => w.byId.get(id)).filter((t) => t?.type === "tag");
  return (
    <div
      role="option"
      aria-selected={selected}
      data-id={task.id}
      draggable
      onDragStart={onDragStart}
      onMouseDown={onSelect}
      onDoubleClick={onOpen}
      className={`group flex min-h-(--row-height) items-center gap-2.5 rounded-md px-2 py-[5px] ${selected ? "bg-selected" : "hover:bg-muted/70"}`}
    >
      {task.type === "project" ? (
        <button type="button" aria-label="Open project" onClick={onOpen} className="shrink-0">
          <ProgressRing {...progress(w, task.id)} status={task.status} />
        </button>
      ) : (
        <Checkbox
          task={task}
          disabled={task.type === "todo" && !!task.repeat}
          onToggle={() => change(setStatus([task.id], "completed"))}
        />
      )}
      {context === "logbook" && task.stopped && (
        <span className="w-12 shrink-0 text-xs text-muted-foreground">
          {stoppedLabel(task.stopped)}
        </span>
      )}
      {inToday && (
        <StarIcon weight="fill" className="size-3 shrink-0 text-today" aria-label="Today" />
      )}
      {task.evening && context !== "today" && !done && (
        <MoonIcon
          weight="fill"
          className="size-3 shrink-0 text-evening"
          aria-label="This Evening"
        />
      )}
      {showWhen && (
        <span className="shrink-0 rounded bg-muted px-1.5 text-meta text-muted-foreground">
          {dayLabel(task.when!, today)}
        </span>
      )}
      <span
        className={`min-w-0 truncate ${done ? "text-muted-foreground" : ""} ${task.type === "project" ? "font-medium" : ""} ${!task.title ? "text-muted-foreground" : ""}`}
      >
        {task.title || (task.type === "project" ? "New Project" : "New To-Do")}
      </span>
      {task.type === "todo" && (task.template || task.repeat) && (
        <ArrowsClockwiseIcon
          className="size-3 shrink-0 text-muted-foreground"
          aria-label="Repeating"
        />
      )}
      {task.type === "todo" && task.reminder && (
        <BellIcon className="size-3 shrink-0 text-muted-foreground" aria-label="Reminder" />
      )}
      {task.notes && (
        <NoteIcon className="size-3 shrink-0 text-muted-foreground" aria-label="Notes" />
      )}
      {checklist.length > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-meta text-muted-foreground">
          <ListChecksIcon className="size-3" />
          {checklist.filter((c) => c.done).length}/{checklist.length}
        </span>
      )}
      <span className="flex-1" />
      {context !== "project" && parent && "title" in parent && (
        <span className="max-w-40 shrink-0 truncate text-meta text-muted-foreground">
          {parent.title}
        </span>
      )}
      {tags.map((t) => (
        <span
          key={t!.id}
          className="shrink-0 rounded-full border px-1.5 text-meta text-muted-foreground"
        >
          {"title" in t! ? t.title : ""}
        </span>
      ))}
      {task.deadline && !done && (
        <span
          className={`flex shrink-0 items-center gap-1 text-meta ${task.deadline <= today ? "text-deadline" : "text-muted-foreground"}`}
        >
          <FlagIcon weight="fill" className="size-3" />
          {deadlineLabel(task.deadline, today)}
        </span>
      )}
    </div>
  );
}
