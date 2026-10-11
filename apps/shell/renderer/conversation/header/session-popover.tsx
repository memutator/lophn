// 머리의 session popover 안쪽(shell/desktop#R39). 검색, Today·Earlier 목록, 줄 단추, Archived, New session.
// popover가 열려 있는 동안만 mount되므로 검색어·이름 고치기·삭제 확인 같은 지역 상태는 닫으면 사라진다.
import {
  type KeyboardEvent,
  type MutableRefObject,
  type ReactElement,
  useEffect,
  useState,
} from "react";
import {
  Button,
  editorIcons,
  Icon,
  IconButton,
  iconPixels,
  launcherIcons,
  lophnSpaceIcons,
  paletteIcons,
} from "@lophn/design/components";

import type { SessionGroup, SessionLine } from "./agent-header.tsx";
import styles from "./session-popover.module.css";

const GROUPS: readonly { group: SessionGroup; head: string }[] = [
  { group: "today", head: "Today" },
  { group: "earlier", head: "Earlier" },
];

const STATUS_LABEL = {
  waiting: "Waiting for you",
  working: "Working",
} as const;

const SECOND = 1000;
const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * SECOND],
  ["month", 30 * 24 * 60 * 60 * SECOND],
  ["day", 24 * 60 * 60 * SECOND],
  ["hour", 60 * 60 * SECOND],
  ["minute", 60 * SECOND],
];

const relative = new Intl.RelativeTimeFormat("en", { numeric: "always" });

/** `now` 기준 상대 시각("2 minutes ago"). 1분이 안 되면 "now". */
export function sinceLabel(activeAt: string, now: Date): string {
  const elapsed = now.getTime() - new Date(activeAt).getTime();
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) {
      return relative.format(-Math.floor(elapsed / size), unit);
    }
  }
  return "now";
}

export interface SessionPopoverProps {
  /** 머리의 agent 이름(검색칸 이름). */
  agentName: string;
  /** 이 agent의 session만 든 목록(archived 포함, 부르는 쪽 정렬 그대로). */
  lines: readonly SessionLine[];
  currentId: string;
  now: Date;
  onSwitch: (session: string) => void;
  onNew: () => void;
  onRename: (session: string, title: string) => void;
  onArchive: (session: string) => void;
  onUnarchive: (session: string) => void;
  onDelete: (session: string) => void;
  /**
   * Escape·바깥 누름이 popover를 닫으려 할 때 부르는 쪽이 먼저 묻는다. 이름 고치기나 삭제 확인이 열려
   * 있으면 그것만 접고 true를 돌려 popover는 남긴다.
   */
  dismiss: MutableRefObject<(() => boolean) | null>;
}

function StatusDot({ status }: { status: SessionLine["status"] }) {
  if (status === "idle") {
    return <span className={styles.dot} aria-hidden="true" />;
  }
  return (
    <span
      className={`${styles.dot} ${styles[status]}`}
      role="img"
      aria-label={STATUS_LABEL[status]}
    >
      {status === "waiting" ? "●" : "◐"}
    </span>
  );
}

// 목록 안에서 위·아래 화살표로 줄 사이를 옮긴다.
function moveBetweenRows(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = [
    ...event.currentTarget.closest("[role=listbox]")?.querySelectorAll<
      HTMLElement
    >("[role=option]") ?? [],
  ];
  const at = rows.indexOf(event.currentTarget);
  const next = rows[at + (event.key === "ArrowDown" ? 1 : -1)];
  if (next) {
    event.preventDefault();
    next.focus();
  }
}

export function SessionPopover(props: SessionPopoverProps): ReactElement {
  const { agentName, lines, currentId, now, dismiss } = props;
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    dismiss.current = () => {
      if (editing === null && deleting === null) return false;
      setEditing(null);
      setDeleting(null);
      return true;
    };
    return () => {
      dismiss.current = null;
    };
  });

  const needle = query.trim().toLowerCase();
  const live = lines.filter((line) =>
    !line.archived && line.title.toLowerCase().includes(needle)
  );
  const archived = lines.filter((line) => line.archived);

  const startRename = (line: SessionLine) => {
    setDeleting(null);
    setDraft(line.title);
    setEditing(line.id);
  };
  const save = (line: SessionLine) => {
    const title = draft.trim();
    if (title === "") return;
    props.onRename(line.id, title);
    setEditing(null);
  };

  const row = (line: SessionLine) => {
    if (editing === line.id) {
      return (
        <div key={line.id} className={styles.edit}>
          <input
            className={styles.renameInput}
            aria-label={`Rename ${line.title}`}
            value={draft}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") save(line);
              if (event.key === "Escape") {
                event.stopPropagation();
                setEditing(null);
              }
            }}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={draft.trim() === ""}
            onClick={() => save(line)}
          >
            Save
          </Button>
          <Button size="sm" onClick={() => setEditing(null)}>Cancel</Button>
        </div>
      );
    }
    if (deleting === line.id) {
      return (
        <div
          key={line.id}
          className={styles.confirm}
          role="alertdialog"
          aria-label={`Delete ${line.title}`}
        >
          <p className={styles.confirmText}>
            Delete "{line.title}"? This can't be undone.
          </p>
          <div className={styles.confirmActions}>
            <Button
              size="sm"
              variant="danger"
              autoFocus
              onClick={() => {
                props.onDelete(line.id);
                setDeleting(null);
              }}
            >
              Delete
            </Button>
            <Button size="sm" onClick={() => setDeleting(null)}>Cancel</Button>
          </div>
        </div>
      );
    }
    const current = line.id === currentId;
    return (
      <div
        key={line.id}
        role="option"
        data-session={line.id}
        aria-selected={current}
        tabIndex={0}
        className={styles.row}
        onClick={() => props.onSwitch(line.id)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            props.onSwitch(line.id);
          }
          moveBetweenRows(event);
        }}
      >
        <span className={styles.check} data-check>{current ? "✓" : ""}</span>
        <StatusDot status={line.status} />
        <span className={styles.sessionTitle} data-session-title>
          {line.title}
        </span>
        <span className={styles.when} data-session-when>
          {sinceLabel(line.activeAt, now)}
        </span>
        <span className={styles.actions}>
          <IconButton
            icon={editorIcons.edit}
            label="Rename"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              startRename(line);
            }}
          />
          <IconButton
            icon={lophnSpaceIcons.archive}
            label="Archive"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              props.onArchive(line.id);
            }}
          />
          <IconButton
            icon={launcherIcons.remove}
            label="Delete"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setEditing(null);
              setDeleting(line.id);
            }}
          />
        </span>
      </div>
    );
  };

  return (
    <div className={styles.switcher} data-session-popover>
      <label className={styles.search}>
        <Icon icon={paletteIcons.search} pixels={iconPixels("base")} />
        <input
          className={styles.searchInput}
          aria-label={`Search ${agentName} sessions`}
          placeholder={`Search ${agentName} sessions`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div
        className={styles.list}
        role="listbox"
        aria-label={`${agentName} sessions`}
      >
        {live.length === 0
          ? <p className={styles.noMatch} data-no-match>No sessions match.</p>
          : GROUPS.map(({ group, head }) => {
            const inGroup = live.filter((line) => line.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div key={group} role="group" aria-label={head}>
                <p className={styles.groupHead} data-session-group>{head}</p>
                {inGroup.map(row)}
              </div>
            );
          })}
      </div>
      <div className={styles.foot}>
        {archived.length > 0 && (
          <button
            type="button"
            className={styles.archivedToggle}
            aria-expanded={showArchived}
            onClick={() => setShowArchived(!showArchived)}
          >
            <Icon
              icon={showArchived
                ? lophnSpaceIcons.collapse
                : lophnSpaceIcons.expand}
              pixels={iconPixels("small")}
            />
            Archived ({archived.length})
          </button>
        )}
        {showArchived && (
          <ul className={styles.archivedList}>
            {archived.map((line) => (
              <li
                key={line.id}
                className={styles.archivedItem}
                data-archived-session={line.id}
              >
                <span className={styles.sessionTitle} data-session-title>
                  {line.title}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => props.onUnarchive(line.id)}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button size="sm" icon={lophnSpaceIcons.add} onClick={props.onNew}>
          New session
        </Button>
      </div>
    </div>
  );
}
