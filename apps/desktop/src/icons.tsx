import {
  ArchiveIcon,
  BookOpenIcon,
  CalendarDotsIcon,
  StackIcon,
  StarIcon,
  TagIcon,
  TrashIcon,
  TrayIcon,
  CubeIcon,
} from "@phosphor-icons/react";
import type { View } from "@stuff/core/machine";

export const LIST_ICONS = {
  inbox: { Icon: TrayIcon, color: "text-sky-600 dark:text-sky-400" },
  today: { Icon: StarIcon, color: "text-today" },
  upcoming: { Icon: CalendarDotsIcon, color: "text-rose-600 dark:text-rose-400" },
  anytime: { Icon: StackIcon, color: "text-primary" },
  someday: { Icon: ArchiveIcon, color: "text-someday" },
  logbook: { Icon: BookOpenIcon, color: "text-emerald-700 dark:text-emerald-400" },
  trash: { Icon: TrashIcon, color: "text-muted-foreground" },
} as const;

export function ViewIcon({ view, className = "size-[18px]" }: { view: View; className?: string }) {
  if (view in LIST_ICONS) {
    const { Icon, color } = LIST_ICONS[view as keyof typeof LIST_ICONS];
    return (
      <Icon weight={view === "today" ? "fill" : "regular"} className={`${className} ${color}`} />
    );
  }
  if (view.startsWith("area:"))
    return <CubeIcon className={`${className} text-muted-foreground`} />;
  if (view.startsWith("tag:")) return <TagIcon className={`${className} text-muted-foreground`} />;
  return null;
}

/** A project's progress as a ring that fills, closed when the project is done. */
export function ProgressRing({
  done,
  total,
  status = "open",
  className = "size-[15px]",
}: {
  done: number;
  total: number;
  status?: string;
  className?: string;
}) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const share = status !== "open" ? 1 : total ? done / total : 0;
  return (
    <svg viewBox="0 0 16 16" className={`${className} shrink-0 text-primary`} aria-hidden>
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle
        cx="8"
        cy="8"
        r={r / 2}
        fill="none"
        stroke="currentColor"
        strokeWidth={r}
        strokeDasharray={`${(share * c) / 2} ${c}`}
        transform="rotate(-90 8 8)"
        opacity={0.85}
      />
    </svg>
  );
}
