// agent header의 session switcher. 탭 머리의 "[avatar] 이름 · session 제목 ▾"를 누르면 열리는 popover.
// 맨 위 검색 input, 그 agent의 session만(Today / Earlier), 줄에 hover하면 Rename·Archive·Delete,
// Archived 줄, + New session. 이름 고치기는 줄이 input으로 바뀌고, 삭제는 확인을 거친다. session 상태는
// 열림, archive, 지움 셋이다. archive한 session은 눌러 열면 기록만 읽을 수 있고 되살리는 단추는 없다.
import { useState } from "react";
import {
  Button,
  Icon,
  IconButton,
  iconPixels,
  Popover,
  Tooltip,
} from "@lophn/design/components";
import {
  editorIcons,
  launcherIcons,
  lophnSpaceIcons,
  paletteIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";

import menuStyles from "../../../../packages/design/components/menu/menu.module.css";
import { Avatar } from "./agent-avatar.tsx";
import {
  type SessionRow,
  sessionsOf,
  type SwitcherDemo,
} from "./agents-data.ts";
import a from "./agents.module.css";

const STATE_LABEL = { waiting: "Waiting for you", working: "Working" } as const;

/** 상태 점. 사람을 기다리면 ●, 일하는 중이면 ◐, 아니면 점이 없다(칸은 유지). */
function SessionDot({ state }: { state: SessionRow["state"] }) {
  if (state === "idle") {
    return <span className={a.dotSlot} aria-hidden="true" />;
  }
  return (
    <span
      className={`${a.dotSlot} ${a.sessionDot} ${a[`state_${state}`]}`}
      role="img"
      aria-label={STATE_LABEL[state]}
      title={STATE_LABEL[state]}
    >
      {state === "waiting" ? "●" : "◐"}
    </span>
  );
}

// 시연 상태의 줄: hover한 줄, 이름을 고치는 줄, 삭제 확인이 붙은 줄.
const DEMO_HOVER = "harness";
const DEMO_RENAME = "c049";
const DEMO_DELETE = "release-check";

export function SessionSwitcher(
  { agent, currentId, title, demo, onPick, onNew }: {
    agent: string;
    currentId: string;
    title: string;
    demo?: SwitcherDemo;
    onPick: (row: SessionRow) => void;
    onNew: () => void;
  },
) {
  const [open, setOpen] = useState(demo !== undefined);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<readonly SessionRow[]>(sessionsOf(agent));
  const [renaming, setRenaming] = useState<string | null>(
    demo === "edit" ? DEMO_RENAME : null,
  );
  const [draft, setDraft] = useState(
    rows.find((row) => row.id === DEMO_RENAME)?.title ?? "",
  );
  const [deleting, setDeleting] = useState<string | null>(
    demo === "edit" ? DEMO_DELETE : null,
  );
  const [showArchived, setShowArchived] = useState(demo !== undefined);
  const needle = query.trim().toLowerCase();
  const live = rows.filter((row) =>
    row.group !== "archived" && row.title.toLowerCase().includes(needle)
  );
  const archived = rows.filter((row) => row.group === "archived");
  const patch = (id: string, change: Partial<SessionRow>) =>
    setRows((now) =>
      now.map((row) => row.id === id ? { ...row, ...change } : row)
    );
  const startRename = (row: SessionRow) => {
    setDeleting(null);
    setDraft(row.title);
    setRenaming(row.id);
  };

  const line = (row: SessionRow) => {
    if (renaming === row.id) {
      return (
        <div key={row.id} className={a.sessionEdit}>
          <input
            className={a.renameInput}
            aria-label={`Rename ${row.title}`}
            value={draft}
            autoFocus={demo === undefined}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draft.trim() !== "") {
                patch(row.id, { title: draft.trim() });
                setRenaming(null);
              }
              if (event.key === "Escape") setRenaming(null);
            }}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={draft.trim() === ""}
            onClick={() => {
              patch(row.id, { title: draft.trim() });
              setRenaming(null);
            }}
          >
            Save
          </Button>
          <Button size="sm" onClick={() => setRenaming(null)}>Cancel</Button>
        </div>
      );
    }
    if (deleting === row.id) {
      return (
        <div key={row.id} className={a.sessionConfirm} role="alertdialog">
          <p className={a.confirmText}>
            Delete "{row.title}"? Anything other agents handed to this session
            and still waiting for an answer will fail. This can't be undone.
          </p>
          <div className={a.confirmActions}>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setRows((now) => now.filter((item) => item.id !== row.id));
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
    const hovered = demo !== undefined && row.id === DEMO_HOVER;
    return (
      <div
        key={row.id}
        role="option"
        aria-selected={row.id === currentId}
        tabIndex={0}
        className={`${menuStyles.item} ${a.sessionRow}`}
        data-highlighted={hovered ? "" : undefined}
        data-hover={hovered ? "" : undefined}
        onClick={() => {
          onPick(row);
          setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onPick(row);
            setOpen(false);
          }
        }}
      >
        <span className={a.sessionCheck}>
          {row.id === currentId ? "✓" : ""}
        </span>
        <SessionDot state={row.state} />
        <span className={a.sessionTitle}>{row.title}</span>
        <span className={a.sessionWhen}>{row.when}</span>
        <span
          className={a.sessionActions}
          onClick={(event) => event.stopPropagation()}
        >
          <Tooltip
            content="Rename"
            open={hovered && demo === "open" ? true : undefined}
          >
            <IconButton
              icon={editorIcons.edit}
              label="Rename"
              size="sm"
              onClick={() => startRename(row)}
            />
          </Tooltip>
          <IconButton
            icon={lophnSpaceIcons.archive}
            label="Archive"
            size="sm"
            onClick={() => patch(row.id, { group: "archived" })}
          />
          <IconButton
            icon={launcherIcons.remove}
            label="Delete"
            size="sm"
            onClick={() => {
              setRenaming(null);
              setDeleting(row.id);
            }}
          />
        </span>
      </div>
    );
  };

  const section = (group: SessionRow["group"], head: string) => {
    const list = live.filter((row) => row.group === group);
    if (list.length === 0) return null;
    return (
      <div role="presentation">
        <p className={a.modelGroup}>{head}</p>
        {list.map(line)}
      </div>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="beside"
      trigger={
        <button type="button" className={a.agentHeader} aria-label="Sessions">
          <Avatar agent={agent} />
          <span className={a.headerName}>{agent}</span>
          <span className={a.headerSep}>·</span>
          <span className={a.headerTitle}>{title}</span>
          <Icon icon={lophnSpaceIcons.collapse} pixels={iconPixels("small")} />
        </button>
      }
    >
      <div className={a.switcher}>
        <label className={a.modelSearch}>
          <Icon icon={paletteIcons.search} pixels={iconPixels("base")} />
          <input
            className={a.bareInput}
            aria-label={`Search ${agent} sessions`}
            placeholder={`Search ${agent} sessions`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className={a.sessionList} role="listbox" aria-label="Sessions">
          {live.length === 0
            ? <p className={a.noMatch}>No sessions match.</p>
            : null}
          {section("today", "Today")}
          {section("earlier", "Earlier")}
        </div>
        <div className={a.switcherFoot}>
          <button
            type="button"
            className={a.archivedRow}
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
          {showArchived
            ? (
              <ul className={a.archivedList}>
                {archived.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={a.archivedItem}
                      aria-label={`Read ${row.title}`}
                      onClick={() => {
                        onPick(row);
                        setOpen(false);
                      }}
                    >
                      <span className={a.sessionTitle}>{row.title}</span>
                      <span className={a.sessionWhen}>{row.when}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
            : null}
          <Button
            size="sm"
            icon={lophnSpaceIcons.add}
            onClick={() => {
              onNew();
              setOpen(false);
            }}
          >
            New session
          </Button>
        </div>
      </div>
    </Popover>
  );
}
