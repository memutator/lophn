// Background(run) 목록. run 줄 아래에 그 run이 연 session을 agent 묶음의 session처럼 들여 쓴다. project sidebar의 Agent 쪽과
// 앱 공간의 오른쪽 패널이 같이 쓰므로 session 줄(`SessionItem`)도 여기에 둔다(sidebar의 agent 묶음도 이것을 쓴다).
import { Avatar, type AvatarProfile } from "../../parts/avatar/avatar.tsx";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { settingsIcons } from "../../icons/mod.ts";
import { formatRelativeTime, t } from "@lophn/wording";

import type { CallAgent } from "../../../../protocol/lophn-agent/calls.ts";
import type { PanelSession } from "./use-agent-panel.ts";
import styles from "./project-sidebar.module.css";

export type RunStateView = "running" | "done" | "failed" | "cancelled";

/** run 기록(`runs/list`)에서 화면이 쓰는 칸. renderer는 protocol을 type check하지 않아 id는 문자열이다. */
export interface RunRecordView {
  readonly id: string;
  readonly kind: "agent" | "tool";
  /** agent: 이름을 푼 agent(`SessionEntry.agent`와 같은 `CallAgent`). tool: 앱 id와 tool 이름. */
  readonly target:
    | { readonly agent: CallAgent }
    | { readonly app: string; readonly tool: string };
  readonly session: string | null;
  readonly session_opened: boolean;
  readonly state: RunStateView;
  readonly created_at: string;
}

/** 목록의 run 한 줄. */
export interface RunRow {
  readonly id: string;
  /** agent 이름 또는 tool 이름. */
  readonly name: string;
  /** agent의 avatar. tool run은 null이라 tool 아이콘을 그린다. */
  readonly profile: AvatarProfile | null;
  readonly state: RunStateView;
  /** 시작한 때(epoch ms). */
  readonly at: number;
  /** run이 연 session. 없으면 null(`--session`으로 이어 쓴 run, tool run). */
  readonly session: PanelSession | null;
}

function Dot({ status }: { status: PanelSession["status"] }) {
  const label = status === "waiting"
    ? t("project-workspace.label.agent-waiting")
    : status === "working"
    ? t("common.label.tab-working")
    : undefined;
  return (
    <span
      className={styles.sessionDot}
      data-state={status === "idle" ? undefined : status}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
    />
  );
}

export function SessionItem(
  { session, agentName, onSession }: {
    session: PanelSession;
    /** 있으면 제목 아래에 "agent · 시각"을 보인다(Recent). */
    agentName?: string;
    onSession: (session: PanelSession) => void;
  },
) {
  const when = formatRelativeTime(new Date(session.at), new Date());
  return (
    <li className={styles.li}>
      <button
        type="button"
        className={`${styles.item} ${styles.sessionItem}`}
        data-session={session.id}
        onClick={() => onSession(session)}
      >
        <Dot status={session.status} />
        <span className={styles.sessionText}>
          <span className={styles.label}>{session.title}</span>
          {agentName === undefined
            ? null
            : <span className={styles.sessionMeta}>{agentName} · {when}</span>}
        </span>
        {agentName === undefined
          ? <span className={styles.sessionWhen}>{when}</span>
          : null}
      </button>
    </li>
  );
}

// 오른쪽 끝 고정 열: 시각 아래에 상태. done은 상태 표시가 없다.
function RunState({ state }: { state: RunStateView }) {
  if (state === "running") {
    return (
      <span
        className={styles.sessionDot}
        data-state="working"
        role="img"
        aria-label={t("common.label.tab-working")}
      />
    );
  }
  if (state === "done") return null;
  return (
    <span className={styles.runState} data-tone={state}>
      {state === "failed"
        ? t("run-list.label.failed")
        : t("run-list.label.cancelled")}
    </span>
  );
}

export function RunList(
  { runs, onSession }: {
    runs: readonly RunRow[];
    onSession: (session: PanelSession) => void;
  },
) {
  return (
    <ul className={styles.list} role="list">
      {runs.map((run) => (
        <li
          key={run.id}
          className={styles.agentGroup}
          data-run={run.id}
          data-run-state={run.state}
        >
          <div className={`${styles.li} ${styles.runRow}`}>
            {run.profile === null
              ? (
                <span className={styles.runIcon}>
                  <Icon
                    icon={settingsIcons.tools}
                    pixels={iconPixels("small")}
                  />
                </span>
              )
              : <Avatar profile={run.profile} size="sm" />}
            <span className={styles.label}>{run.name}</span>
            <span className={styles.runMeta}>
              <span className={styles.sessionWhen}>
                {formatRelativeTime(new Date(run.at), new Date())}
              </span>
              <RunState state={run.state} />
            </span>
          </div>
          {run.session === null
            ? null
            : (
              <ul className={`${styles.list} ${styles.sessions}`} role="list">
                <SessionItem session={run.session} onSession={onSession} />
              </ul>
            )}
        </li>
      ))}
    </ul>
  );
}
