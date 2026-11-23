import {
  ArrowsClockwiseIcon,
  CalendarBlankIcon,
  FlagIcon,
  ListChecksIcon,
  MoonIcon,
  StarIcon,
  TagIcon,
  XIcon,
} from "@phosphor-icons/react";
import { checklistOf, type Task, type World } from "@stuff/core/lists";
import type { Day, Id } from "@stuff/core/model";
import { add, destroy, set, setStatus } from "@stuff/core/ops";
import { Popover, PopoverContent, PopoverTrigger } from "@stuff/ui/components/popover";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Stuff, useChange } from "./app.ts";
import { dayLabel, deadlineLabel } from "./format.ts";
import { DeadlinePicker, RepeatPicker, TagPicker, WhenPicker } from "./pickers.tsx";
import { Checkbox } from "./Row.tsx";

/** A text field that writes on blur, so typing doesn't create one sync write per key. */
function useDraft(value: string, save: (v: string) => void) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  return {
    value: draft,
    onFocus: () => void (editing.current = true),
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => {
      editing.current = false;
      if (draft !== value) save(draft);
    },
  };
}

export function Markdown({ text }: { text: string }) {
  const html = DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true }));
  return (
    <div className="notes selectable space-y-1.5" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

/** Notes shown as Markdown, edited as plain text on click. */
export function Notes({
  id,
  notes,
  placeholder = "Notes",
}: {
  id: Id;
  notes: string;
  placeholder?: string;
}) {
  const change = useChange();
  const [editing, setEditing] = useState(false);
  const draft = useDraft(notes, (v) => change(set([id], { notes: v })));
  if (!editing && notes)
    return (
      <div
        onClick={(e) => (e.target as HTMLElement).tagName !== "A" && setEditing(true)}
        className="cursor-text text-[13px] leading-relaxed"
      >
        <Markdown text={notes} />
      </div>
    );
  return (
    <textarea
      {...draft}
      autoFocus={editing}
      onBlur={() => {
        draft.onBlur();
        setEditing(false);
      }}
      onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLTextAreaElement).blur()}
      placeholder={placeholder}
      rows={Math.max(2, draft.value.split("\n").length)}
      className="w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
    />
  );
}

function Chip({
  label,
  icon,
  children,
  onClear,
}: {
  label: ReactNode;
  icon: ReactNode;
  children: (done: () => void) => ReactNode;
  onClear?(): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex items-center rounded-md bg-muted text-xs">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="flex items-center gap-1 px-2 py-1">
          {icon}
          {label}
        </PopoverTrigger>
        <PopoverContent className="w-64 rounded-xl p-3">
          {children(() => setOpen(false))}
        </PopoverContent>
      </Popover>
      {onClear && (
        <button
          type="button"
          aria-label="Clear"
          onClick={onClear}
          className="pr-1.5 text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </span>
  );
}

function ToolButton({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: (done: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        title={label}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {icon}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 rounded-xl p-3">
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

function Checklist({ todo, w }: { todo: Id; w: World }) {
  const change = useChange();
  const items = checklistOf(w, todo);
  const refs = useRef(new Map<Id, HTMLInputElement>());
  const [focus, setFocus] = useState<Id | null>(null);
  useEffect(() => {
    if (focus) refs.current.get(focus)?.focus();
  }, [focus, items.length]);
  const addAfter = (after?: Id) =>
    change((ctx) => {
      const docs = add("checklist", { title: "", todo }, undefined, after)(ctx);
      setFocus(docs[0]!.id);
      return docs;
    });
  return (
    <div className="flex flex-col">
      {items.map((c) => (
        <div key={c.id} className="flex items-center gap-2 border-b border-border/60 py-1">
          <button
            type="button"
            role="checkbox"
            aria-checked={c.done}
            aria-label="Check"
            onClick={() => change(set([c.id], { done: !c.done }))}
            className={`size-3 shrink-0 rounded-full border-[1.5px] ${c.done ? "border-primary bg-primary" : "border-muted-foreground/45"}`}
          />
          <ChecklistTitle
            id={c.id}
            title={c.title}
            done={c.done}
            inputRef={(el) => (el ? refs.current.set(c.id, el) : refs.current.delete(c.id))}
            onEnter={() => addAfter(c.id)}
            onRemove={() => change(destroy([c.id]))}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => addAfter(items.at(-1)?.id)}
        className="py-1 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        + Add checklist item
      </button>
    </div>
  );
}

function ChecklistTitle(props: {
  id: Id;
  title: string;
  done: boolean;
  inputRef(el: HTMLInputElement | null): void;
  onEnter(): void;
  onRemove(): void;
}) {
  const change = useChange();
  const draft = useDraft(props.title, (v) => change(set([props.id], { title: v })));
  return (
    <input
      ref={props.inputRef}
      {...draft}
      aria-label="Checklist item"
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          draft.onBlur();
          props.onEnter();
        }
        if (e.key === "Backspace" && !draft.value) props.onRemove();
      }}
      className={`flex-1 bg-transparent text-[13px] outline-none ${props.done ? "text-muted-foreground line-through" : ""}`}
    />
  );
}

export function Editor({ task, w, today }: { task: Task; w: World; today: Day }) {
  const change = useChange();
  const { send } = Stuff.useActorRef();
  const title = useDraft(task.title, (v) => change(set([task.id], { title: v })));
  const tags = task.tags.map((id) => w.byId.get(id)).filter((t) => t?.type === "tag");
  const hasChecklist = task.type === "todo" && checklistOf(w, task.id).length > 0;
  const [showChecklist, setShowChecklist] = useState(hasChecklist);
  const template = task.type === "todo" && task.template ? w.byId.get(task.template) : undefined;
  const whenLabel =
    task.start === "someday"
      ? "Someday"
      : task.when
        ? task.when <= today
          ? task.evening
            ? "This Evening"
            : "Today"
          : dayLabel(task.when, today)
        : null;
  return (
    <div
      data-id={task.id}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          (document.activeElement as HTMLElement | null)?.blur();
          send({ type: "edit", id: null });
        }
      }}
      className="my-2 flex flex-col gap-2 rounded-xl bg-card px-3 py-3 shadow-[0_1px_4px_rgb(0_0_0/0.08),0_0_0_1px_var(--border)]"
    >
      <div className="flex items-center gap-2.5">
        <Checkbox task={task} onToggle={() => change(setStatus([task.id], "completed"))} />
        <input
          {...title}
          autoFocus={!task.title}
          aria-label="Title"
          placeholder={task.type === "project" ? "New Project" : "New To-Do"}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="flex-1 bg-transparent text-[14px] font-medium outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      <div className="pl-[25px]">
        <Notes id={task.id} notes={task.notes} />
        {task.type === "todo" && (showChecklist || hasChecklist) && (
          <Checklist todo={task.id} w={w} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-[25px]">
        {whenLabel && (
          <Chip
            label={whenLabel}
            icon={
              task.evening ? (
                <MoonIcon weight="fill" className="size-3 text-evening" />
              ) : task.when && task.when <= today ? (
                <StarIcon weight="fill" className="size-3 text-today" />
              ) : (
                <CalendarBlankIcon className="size-3" />
              )
            }
            onClear={() =>
              change(
                set([task.id], {
                  when: null,
                  evening: false,
                  start: task.area || (task.type === "todo" && task.project) ? "anytime" : "inbox",
                }),
              )
            }
          >
            {(done) => <WhenPicker ids={[task.id]} done={done} />}
          </Chip>
        )}
        {tags.map((t) => (
          <span
            key={t!.id}
            className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
          >
            {"title" in t! ? t.title : ""}
          </span>
        ))}
        {task.deadline && (
          <Chip
            label={`Deadline: ${deadlineLabel(task.deadline, today)}`}
            icon={<FlagIcon weight="fill" className="size-3 text-deadline" />}
            onClear={() => change(set([task.id], { deadline: null }))}
          >
            {(done) => <DeadlinePicker ids={[task.id]} done={done} />}
          </Chip>
        )}
        {template && template.type === "todo" && template.repeat && (
          <Chip
            label={`Every ${template.repeat.every > 1 ? `${template.repeat.every} ` : ""}${template.repeat.unit}${template.repeat.every > 1 ? "s" : ""}`}
            icon={<ArrowsClockwiseIcon className="size-3" />}
          >
            {(done) => <RepeatPicker id={task.id} done={done} />}
          </Chip>
        )}
        <span className="flex-1" />
        {!whenLabel && (
          <ToolButton label="When" icon={<CalendarBlankIcon className="size-4" />}>
            {(done) => <WhenPicker ids={[task.id]} done={done} />}
          </ToolButton>
        )}
        <ToolButton label="Tags" icon={<TagIcon className="size-4" />}>
          {(done) => <TagPicker ids={[task.id]} done={done} />}
        </ToolButton>
        {task.type === "todo" && !hasChecklist && (
          <button
            type="button"
            aria-label="Checklist"
            title="Checklist"
            onClick={() => setShowChecklist(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ListChecksIcon className="size-4" />
          </button>
        )}
        {task.type === "todo" && !template && (
          <ToolButton label="Repeat" icon={<ArrowsClockwiseIcon className="size-4" />}>
            {(done) => <RepeatPicker id={task.id} done={done} />}
          </ToolButton>
        )}
        {!task.deadline && (
          <ToolButton label="Deadline" icon={<FlagIcon className="size-4" />}>
            {(done) => <DeadlinePicker ids={[task.id]} done={done} />}
          </ToolButton>
        )}
      </div>
    </div>
  );
}
