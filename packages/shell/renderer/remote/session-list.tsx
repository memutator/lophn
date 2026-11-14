// phone의 session 목록. session과 상태는 sessions-store(snapshot과 event)가 알고, 제목·시각은 agent × workspace 쌍마다
// `sessions/list`로, agent 이름은 `agents/read`로 읽는다. desktop sidebar(탭과 끌기의 모양)는 쓰지 않는다.
import { useMemo } from "react";
import { t } from "@lophn/i18n";
import { agentRead } from "../../../protocol/lophn-agent/agent-definitions.ts";
import { workspaceSessionList } from "../../../protocol/lophn-agent/agent-sessions.ts";
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";
import { TabStateDot } from "../parts/tab-state-dot/tab-state-dot.tsx";
import {
  readRoute,
  readsOf,
  useFollowedRead,
} from "../desktop/connection/core-read.ts";
import {
  useSessions,
  useWaiting,
} from "../desktop/connection/events/hooks.tsx";
import type { SessionEntry } from "../desktop/connection/events/sessions-store.ts";
import type { InboxNames } from "../desktop/connection/waiting/names.ts";
import styles from "./remote.module.css";

export interface SessionRow {
  readonly session: string;
  readonly agent: AgentId | null;
  readonly workspace: SessionEntry["workspace"];
  readonly title: string;
  readonly agentName: string | null;
  readonly state: SessionEntry["state"];
  /** 이 session에서 사람의 답을 기다리는 Inbox 항목 수. */
  readonly waiting: number;
  readonly at: number;
}

export interface WorkspaceGroup {
  readonly key: string;
  readonly name: string;
  readonly rows: readonly SessionRow[];
}

interface Known {
  readonly titles: ReadonlyMap<string, { title: string | null; at: number }>;
  readonly agents: ReadonlyMap<string, string>;
}

const EMPTY: Known = { titles: new Map(), agents: new Map() };

function pairOf(entry: SessionEntry): string {
  return `${entry.agent}\0${entry.workspace?.kind ?? ""}\0${entry.workspace?.id ?? ""}`;
}

/** 쌍마다 session 목록(page 끝까지)과 agent마다 이름. route 하나로 끝나지 않는 읽기라 followed read다. */
function useKnown(entries: readonly SessionEntry[]): Known {
  const live = entries.filter((entry) => entry.agent !== null);
  const pairs = [...new Set(live.map(pairOf))].sort();
  const agents = [...new Set(live.map((entry) => entry.agent!))].sort();
  const lists = pairs.map((pair) => {
    const [agent, kind, id] = pair.split("\0") as [AgentId, string, string];
    return {
      agent,
      workspace:
        kind === "" ? null : ({ kind, id } as SessionEntry["workspace"]),
    };
  });
  const read = useFollowedRead<Known>(
    async (core) => {
      const titles = new Map<string, { title: string | null; at: number }>();
      for (const input of lists) {
        let cursor: string | undefined;
        do {
          const page = await readRoute(core, workspaceSessionList, {
            ...input,
            ...(cursor === undefined ? {} : { cursor }),
          });
          if (!page.ok) break;
          for (const one of page.value.sessions) {
            titles.set(one.id, {
              title: one.title,
              at: Date.parse(one.last_active_at ?? "") || 0,
            });
          }
          cursor = page.value.next_cursor ?? undefined;
        } while (cursor !== undefined);
      }
      const names = new Map<string, string>();
      for (const agent of agents) {
        const one = await readRoute(core, agentRead, { agent });
        if (one.ok) names.set(agent, one.value.effective.name.value);
      }
      return { ok: true, value: { titles, agents: names } };
    },
    [
      ...lists.flatMap((input) => readsOf(workspaceSessionList, input)),
      ...agents.flatMap((agent) => readsOf(agentRead, { agent })),
    ],
    // 새 session이 생기면 그 제목을 읽어야 한다.
    `${pairs.join()}|${entries.map((entry) => entry.session).join()}`,
  ).loaded;
  return read.state === "ready" ? read.value : EMPTY;
}

/** workspace마다 묶은 열린 session. Home이 먼저이고 나머지는 최근 활동 순이다. 묶음 안도 최근 활동 순이다. */
export function useSessionGroups(names: InboxNames): readonly WorkspaceGroup[] {
  const { sessions } = useSessions();
  const { entries: waiting } = useWaiting();
  const known = useKnown(sessions);
  return useMemo(() => {
    const groups = new Map<string, SessionRow[]>();
    for (const entry of sessions) {
      if (entry.ended !== null) continue;
      const key =
        entry.workspace === null
          ? "home"
          : `${entry.workspace.kind}:${entry.workspace.id}`;
      const title = known.titles.get(entry.session);
      const row: SessionRow = {
        session: entry.session,
        agent: entry.agent,
        workspace: entry.workspace,
        title: title?.title ?? t("remote.label.untitled"),
        agentName:
          entry.agent === null ? null : (known.agents.get(entry.agent) ?? null),
        state: entry.state,
        waiting: waiting.filter((one) => one.session === entry.session).length,
        at: title?.at ?? 0,
      };
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const nameOf = (key: string): string => {
      if (key === "home") return t("remote.label.home");
      const [kind, id] = key.split(":") as [string, string];
      return (kind === "project" ? names.projects : names.apps).get(id) ?? id;
    };
    const latest = (rows: readonly SessionRow[]) =>
      Math.max(...rows.map((row) => row.at));
    return [...groups]
      .map(([key, rows]) => ({
        key,
        name: nameOf(key),
        rows: rows.sort((a, b) => b.at - a.at),
      }))
      .sort((a, b) =>
        a.key === "home"
          ? -1
          : b.key === "home"
            ? 1
            : latest(b.rows) - latest(a.rows),
      );
  }, [sessions, waiting, known, names]);
}

const DOT = { waiting: "waiting", running: "working" } as const;

export function SessionList({
  groups,
  onOpen,
}: {
  groups: readonly WorkspaceGroup[];
  onOpen: (session: string) => void;
}) {
  return (
    <>
      <header className={styles.head}>
        <h1 className={styles.headTitle}>{t("remote.heading.sessions")}</h1>
      </header>
      {groups.length === 0 ? (
        <div className={styles.center}>
          <p className={styles.headSub}>{t("remote.notice.no-sessions")}</p>
        </div>
      ) : null}
      {groups.map((group) => (
        <section
          key={group.key}
          className={styles.group}
          aria-label={group.name}
        >
          <div className={styles.groupHead}>{group.name}</div>
          {group.rows.map((row) => {
            // Inbox에 이 session의 항목이 있으면 상태가 아직 따라오지 않았어도 기다림이다.
            const dot =
              row.waiting > 0
                ? "waiting"
                : row.state === "waiting" || row.state === "running"
                  ? DOT[row.state]
                  : null;
            return (
              <button
                key={row.session}
                type="button"
                className={styles.row}
                data-session={row.session}
                onClick={() => onOpen(row.session)}
              >
                <span className={styles.dotSlot}>
                  {dot === null ? null : <TabStateDot dot={dot} />}
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{row.title}</span>
                  {row.agentName === null ? null : (
                    <span className={styles.rowMeta}>{row.agentName}</span>
                  )}
                </span>
                {row.waiting === 0 ? null : (
                  <span className={styles.waiting}>
                    {t("remote.label.waiting-count", { count: row.waiting })}
                  </span>
                )}
              </button>
            );
          })}
        </section>
      ))}
    </>
  );
}
