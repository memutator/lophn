// agent header의 session switcher. "[avatar] 이름 · session 제목 ▾"를 누르면 열리는 popover다.
// 맨 위 검색, 그 agent의 session만(Today·Earlier), 줄에 hover하면 Rename·Archive·Delete, 기다리는 coding 맡기기,
// 접어 둔 Archived, + New session. 이름 고치기는 줄이 input으로 바뀌고, 삭제는 줄 안 확인을 거친다.
// session의 수명은 열림과 archive 둘이고 되살리는 단추는 없다. archive한 줄은 눌러 열면 기록만 읽을 수 있다.
import {
  type KeyboardEvent,
  type MutableRefObject,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { Avatar } from "../../parts/avatar/avatar.tsx";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { Popover } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import {
  actionIcons,
  commonIcons,
  editorIcons,
  homeIcons,
  paletteIcons,
} from "../../icons/mod.ts";
import { type MessageKey, t } from "@lophn/i18n";

import type {
  AgentProfile,
  SessionEntry,
  SessionSearchMatch,
  SessionStatus,
  SourceResult,
} from "../agent-tab-source.ts";
import styles from "./session-popover.module.css";

const GROUPS: readonly { group: "today" | "earlier"; head: MessageKey }[] = [
  { group: "today", head: "common.label.range-today" },
  { group: "earlier", head: "conversation.label.group-earlier" },
];

const STATUS_LABEL = {
  waiting: "conversation.label.requests",
  working: "conversation.label.status-working",
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
function sinceLabel(activeAt: string, now: Date): string {
  const elapsed = now.getTime() - new Date(activeAt).getTime();
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) {
      return relative.format(-Math.floor(elapsed / size), unit);
    }
  }
  return t("conversation.label.since-now");
}

/** 사용자 달력으로 오늘이면 Today, 아니면 Earlier다. */
function groupOf(activeAt: string, now: Date): "today" | "earlier" {
  const day = (value: Date) =>
    `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
  return day(new Date(activeAt)) === day(now) ? "today" : "earlier";
}

const titleOf = (entry: Pick<SessionEntry, "title">): string =>
  entry.title ?? t("conversation.label.session-untitled");

export interface SessionSwitcherProps {
  agent: { readonly name: string; readonly profile: AgentProfile };
  /** 지금 보는 session. null은 아직 만들지 않은 새 session이다. */
  current: { readonly id: string; readonly title: string | null } | null;
  /** 그 agent의 session 전부(archive한 것 포함). 정렬은 여기서 한다. */
  sessions: readonly SessionEntry[];
  now: Date;
  /** 줄을 눌렀다. popover는 닫힌다. archive한 줄이면 기록만 읽는 탭이 열린다. */
  onSwitch: (session: string) => void;
  /** [+ New session]. popover는 닫힌다. null이면 새로 항목이 없다(새 session을 열 길이 없는 harness). */
  onNew: (() => void) | null;
  /**
   * 이름 바꾸기·archive·delete·메시지 찾기까지 보이는가. lophn session은 true이고, 목록·바꾸기·새로뿐인 harness는
   * false다(그 칸의 handler와 `searchMessages`는 부르지 않는다). 안 주면 true다.
   */
  manage?: boolean;
  /** 열림을 바깥이 쥔다(`/resume`이 연다). 안 주면 스스로 든다. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** session을 바꾸는 중이다. trigger에 표시가 서고 목록은 닫힌다. */
  busy?: boolean;
  /** 비지 않은 제목만 부른다. */
  onRename: (session: string, title: string) => void;
  onArchive: (session: string) => void;
  /** 줄 안 확인의 Delete를 누른 뒤에만 부른다. 없으면 Delete 단추가 없다(지울 수 없는 source). */
  onDelete?: (session: string) => void;
  /** 그 agent의 메시지 글(사람이 쓴 말과 agent의 답)에서 찾는다. */
  searchMessages: (
    query: string,
  ) => Promise<SourceResult<readonly SessionSearchMatch[]>>;
  /** 메시지 검색 결과의 줄을 눌렀다. 그 session을 열고 찾기 줄을 그 query로 연다. */
  onOpenMatch: (session: string, query: string) => void;
}

function StatusDot({ status }: { status: SessionStatus }): ReactElement {
  if (status === "idle") {
    return <span className={styles.dot} aria-hidden="true" />;
  }
  return (
    <span
      className={`${styles.dot} ${styles[status]}`}
      role="img"
      aria-label={t(STATUS_LABEL[status])}
    >
      {status === "waiting" ? "●" : "◐"}
    </span>
  );
}

// 목록 안에서 위·아래 화살표로 줄 사이를 옮긴다.
function moveBetweenRows(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = [
    ...(event.currentTarget
      .closest("[role=listbox]")
      ?.querySelectorAll<HTMLElement>("[role=option]") ?? []),
  ];
  const at = rows.indexOf(event.currentTarget);
  const next = rows[at + (event.key === "ArrowDown" ? 1 : -1)];
  if (next) {
    event.preventDefault();
    next.focus();
  }
}

export function SessionSwitcher(props: SessionSwitcherProps): ReactElement {
  const { agent, current } = props;
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.open ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    props.onOpenChange?.(next);
  };
  // 열린 popover가 Escape·바깥 누름을 먼저 받아 안쪽 편집만 접게 한다.
  const dismiss = useRef<(() => boolean) | null>(null);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && dismiss.current?.()) return;
        setOpen(next);
      }}
      placement="beside"
      trigger={
        <button
          type="button"
          className={styles.trigger}
          aria-label={t("conversation.label.session-list", {
            agent: agent.name,
          })}
        >
          <AgentFace agent={agent} />
          <span className={styles.title}>
            {props.busy === true
              ? t("conversation.label.session-opening")
              : current === null
                ? t("conversation.label.session-untitled")
                : titleOf(current)}
          </span>
          <Icon icon={commonIcons.collapse} pixels={iconPixels("small")} />
        </button>
      }
    >
      <Switcher
        {...props}
        dismiss={dismiss}
        onSwitch={(id) => {
          props.onSwitch(id);
          setOpen(false);
        }}
        onNew={
          props.onNew === null
            ? null
            : () => {
                props.onNew?.();
                setOpen(false);
              }
        }
      />
    </Popover>
  );
}

/** header 왼쪽의 "[avatar] 이름 ·". */
export function AgentFace({
  agent,
  sep = true,
}: {
  agent: SessionSwitcherProps["agent"];
  /** 이름 뒤 "·". 뒤에 "›"가 이어지면 끈다. */
  sep?: boolean;
}): ReactElement {
  return (
    <>
      <Avatar profile={agent.profile} size="md" />
      <span className={styles.name}>{agent.name}</span>
      {sep ? <span className={styles.sep}>·</span> : null}
    </>
  );
}

// popover가 열려 있는 동안만 mount되므로 검색어·이름 고치기·삭제 확인 같은 지역 상태는 닫으면 사라진다.
function Switcher(
  props: SessionSwitcherProps & {
    dismiss: MutableRefObject<(() => boolean) | null>;
  },
): ReactElement {
  const { agent, current, now, dismiss } = props;
  const manage = props.manage !== false;
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [matches, setMatches] = useState<readonly SessionSearchMatch[]>([]);
  const searchRequest = useRef(0);

  // 제목은 바로 거르고, 메시지 글은 core가 최근 것부터 blob을 읽으므로 조금 기다렸다 한 번 찾는다.
  useEffect(() => {
    const needle = query.trim();
    if (!manage || needle.length < 2) {
      setMatches([]);
      return;
    }
    const request = searchRequest.current + 1;
    searchRequest.current = request;
    const timer = setTimeout(() => {
      void props.searchMessages(needle).then((result) => {
        if (searchRequest.current === request) {
          setMatches(result.ok ? result.value : []);
        }
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, props.searchMessages]);

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

  const byRecent = [...props.sessions].sort((a, b) =>
    b.activeAt.localeCompare(a.activeAt),
  );
  const needle = query.trim().toLowerCase();
  const live = byRecent.filter(
    (entry) => !entry.archived && titleOf(entry).toLowerCase().includes(needle),
  );
  const archived = byRecent.filter((entry) => entry.archived);

  // session별로 묶는다. 결과는 최근 것부터 오므로 처음 나온 순서가 최신 session 순서다.
  const bySession = new Map<string, SessionSearchMatch[]>();
  for (const match of matches) {
    const list = bySession.get(match.session);
    if (list === undefined) bySession.set(match.session, [match]);
    else list.push(match);
  }
  const matchGroups = [...bySession].map(([session, found]) => {
    const entry = byRecent.find((item) => item.id === session);
    const title =
      entry === undefined
        ? t("conversation.label.session-untitled")
        : titleOf(entry);
    return {
      session,
      title:
        entry?.archived === true
          ? t("conversation.label.session-archived-title", { title })
          : title,
      matches: found,
    };
  });
  const nothing = live.length === 0 && matchGroups.length === 0;

  const startRename = (entry: SessionEntry) => {
    setDeleting(null);
    setDraft(titleOf(entry));
    setEditing(entry.id);
  };
  const save = (entry: SessionEntry) => {
    const title = draft.trim();
    if (title === "") return;
    props.onRename(entry.id, title);
    setEditing(null);
  };

  const row = (entry: SessionEntry) => {
    const title = titleOf(entry);
    if (editing === entry.id) {
      return (
        <div key={entry.id} className={styles.edit}>
          <input
            className={styles.renameInput}
            aria-label={t("conversation.label.rename-session", { title })}
            value={draft}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") save(entry);
              if (event.key === "Escape") {
                event.stopPropagation();
                setEditing(null);
              }
            }}
          />
          <Button size="sm" onClick={() => setEditing(null)}>
            {t("common.button.cancel")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={actionIcons.save}
            disabled={draft.trim() === ""}
            onClick={() => save(entry)}
          >
            {t("conversation.button.save")}
          </Button>
        </div>
      );
    }
    if (deleting === entry.id) {
      return (
        <div
          key={entry.id}
          className={styles.confirm}
          role="alertdialog"
          aria-label={t("conversation.label.delete-session", { title })}
        >
          <p className={styles.confirmText}>
            {t("conversation.body.delete-session", { title })}
          </p>
          <div className={styles.confirmActions}>
            <Button size="sm" onClick={() => setDeleting(null)}>
              {t("common.button.cancel")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={actionIcons.delete}
              autoFocus
              onClick={() => {
                props.onDelete?.(entry.id);
                setDeleting(null);
              }}
            >
              {t("conversation.button.delete")}
            </Button>
          </div>
        </div>
      );
    }
    const here = entry.id === current?.id;
    return (
      <div
        key={entry.id}
        role="option"
        data-session={entry.id}
        aria-selected={here}
        tabIndex={0}
        className={styles.row}
        onClick={() => props.onSwitch(entry.id)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            props.onSwitch(entry.id);
          }
          moveBetweenRows(event);
        }}
      >
        <span className={styles.check} data-check>
          {here ? "✓" : ""}
        </span>
        <StatusDot status={entry.status} />
        <span className={styles.sessionTitle} data-session-title>
          {title}
        </span>
        <span className={styles.when} data-session-when>
          {sinceLabel(entry.activeAt, now)}
        </span>
        {manage ? (
          <span className={styles.actions}>
            <IconButton
              icon={editorIcons.edit}
              label={t("conversation.button.rename")}
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                startRename(entry);
              }}
            />
            <IconButton
              icon={commonIcons.archive}
              label={t("conversation.button.archive")}
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                props.onArchive(entry.id);
              }}
            />
            {props.onDelete === undefined ? null : (
              <IconButton
                icon={homeIcons.remove}
                label={t("conversation.button.delete")}
                size="sm"
                onClick={(event) => {
                  event.stopPropagation();
                  setEditing(null);
                  setDeleting(entry.id);
                }}
              />
            )}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className={styles.switcher} data-session-popover>
      <label className={styles.search}>
        <Icon icon={paletteIcons.search} pixels={iconPixels("base")} />
        <input
          className={styles.searchInput}
          aria-label={t("conversation.label.search-sessions", {
            agent: agent.name,
          })}
          placeholder={t("conversation.label.search-sessions", {
            agent: agent.name,
          })}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div
        className={styles.list}
        role="listbox"
        aria-label={t("conversation.label.session-list", {
          agent: agent.name,
        })}
      >
        {nothing ? (
          <p className={styles.noMatch} data-no-match>
            {t("conversation.notice.session-no-match")}
          </p>
        ) : (
          <>
            {GROUPS.map(({ group, head }) => {
              const inGroup = live.filter(
                (entry) => groupOf(entry.activeAt, now) === group,
              );
              if (inGroup.length === 0) return null;
              return (
                <div key={group} role="group" aria-label={t(head)}>
                  <p className={styles.groupHead} data-session-group>
                    {t(head)}
                  </p>
                  {inGroup.map(row)}
                </div>
              );
            })}
            {matchGroups.map((group) => (
              <div
                key={`match-${group.session}`}
                role="group"
                aria-label={group.title}
              >
                <p className={styles.groupHead} data-session-group>
                  {group.title}
                </p>
                {group.matches.map((match) => (
                  <button
                    key={match.message}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className={styles.matchRow}
                    data-session-match={match.message}
                    onClick={() =>
                      props.onOpenMatch(group.session, query.trim())
                    }
                  >
                    <span className={styles.matchSnippet}>{match.snippet}</span>
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
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
              icon={showArchived ? commonIcons.collapse : commonIcons.expand}
              pixels={iconPixels("small")}
            />
            {t("conversation.button.archived-toggle", {
              count: archived.length,
            })}
          </button>
        )}
        {showArchived && (
          <ul className={styles.archivedList}>
            {archived.map((entry) => (
              <li key={entry.id} data-archived-session={entry.id}>
                <button
                  type="button"
                  className={styles.archivedItem}
                  aria-label={t("conversation.label.read-session", {
                    title: titleOf(entry),
                  })}
                  onClick={() => props.onSwitch(entry.id)}
                >
                  <span className={styles.sessionTitle} data-session-title>
                    {titleOf(entry)}
                  </span>
                  <span className={styles.when}>
                    {sinceLabel(entry.activeAt, now)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {props.onNew === null ? null : (
          <Button size="sm" icon={actionIcons.create} onClick={props.onNew}>
            {t("conversation.button.session-new")}
          </Button>
        )}
      </div>
    </div>
  );
}
