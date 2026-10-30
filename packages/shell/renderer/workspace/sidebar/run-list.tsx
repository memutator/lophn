// Background(run) 목록. run 줄 아래에 그 run이 연 session을 들여 쓴다. project sidebar의 Agent 쪽과
// 앱 공간의 오른쪽 패널이 같이 쓴다. 상태 점은 탭 줄과 같은 `TabStateDot`이다.
import { Avatar, type AvatarProfile } from "../../parts/avatar/avatar.tsx";
import { TabStateDot } from "../../parts/tab-state-dot/tab-state-dot.tsx";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { settingsIcons } from "../../icons/mod.ts";
import { formatRelativeTime, t } from "@lophn/i18n";

import type {
  AgentId,
  Place,
} from "../../../../protocol/lophn-agent/places.ts";
import type { PanelSession } from "./use-agent-panel.ts";
import styles from "./project-sidebar.module.css";

export type RunStateView = "running" | "done" | "failed" | "cancelled";

/** run 기록(`runs/list`)에서 화면이 쓰는 칸. renderer는 protocol을 type check하지 않아 id는 문자열이다. */
export interface RunRecordView {
  readonly id: string;
  readonly kind: "agent" | "tool";
  /** agent: 이름을 푼 agent와 그 session의 place. tool: 앱 id와 tool 이름. */
  readonly target:
    | {
        readonly agent: {
          readonly agent: AgentId;
          readonly place: Place | null;
        };
      }
    | { readonly app: string; readonly tool: string };
  readonly session: string | null;
  readonly session_opened: boolean;
  readonly state: RunStateView;
  readonly created_at: string;
  /** job이 연 run이고 그 job이 아직 있으면 id와 제목. 지워진 job이면 일반 run처럼 null. */
  readonly job: { readonly id: string; readonly title: string } | null;
}

/** 목록의 run 한 줄. */
export interface RunRow {
  readonly id: string;
  /** 첫 줄. job이 연 run이면 job 제목, 아니면 agent 이름 또는 tool 이름. */
  readonly name: string;
  /** job이 연 run이면 둘째 줄에 시각 앞으로 가는 agent 이름 또는 tool 이름. */
  readonly via: string | null;
  /** agent의 avatar. tool run은 null이라 tool 아이콘을 그린다. */
  readonly profile: AvatarProfile | null;
  readonly state: RunStateView;
  /** 시작한 때(epoch ms). */
  readonly at: number;
  /** run이 연 session. 없으면 null(`--session`으로 이어 쓴 run, tool run). */
  readonly session: PanelSession | null;
}

// run 아래 session 줄. 시각은 run 줄에 있어 점만 오른쪽 끝에 둔다.
function SessionItem({
  session,
  onSession,
}: {
  session: PanelSession;
  onSession: (session: PanelSession) => void;
}) {
  return (
    <li className={styles.li}>
      <button
        type="button"
        className={`${styles.item} ${styles.sessionItem}`}
        data-session={session.id}
        onClick={() => onSession(session)}
      >
        <span className={styles.label}>{session.title}</span>
        {session.dot === null ? null : <TabStateDot dot={session.dot} />}
      </button>
    </li>
  );
}

// 이름 아래 줄. 시각 뒤에 failed·cancelled만 상태를 붙인다. done은 상태 표시가 없다.
function RunMeta({ run }: { run: RunRow }) {
  const when = formatRelativeTime(new Date(run.at), new Date());
  return (
    <span className={styles.sessionMeta}>
      {run.via === null ? when : `${run.via} · ${when}`}
      {run.state === "failed" || run.state === "cancelled" ? (
        <>
          {" · "}
          <span className={styles.runState} data-tone={run.state}>
            {run.state === "failed"
              ? t("run-list.label.failed")
              : t("run-list.label.cancelled")}
          </span>
        </>
      ) : null}
    </span>
  );
}

// session 줄이 있는 run은 점을 그리지 않는다. 그 줄의 점이 상태를 보인다.
export function RunList({
  runs,
  onSession,
}: {
  runs: readonly RunRow[];
  onSession: (session: PanelSession) => void;
}) {
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
            {run.profile === null ? (
              <span className={styles.runIcon}>
                <Icon icon={settingsIcons.tools} pixels={iconPixels("small")} />
              </span>
            ) : (
              <Avatar profile={run.profile} size="sm" />
            )}
            <span className={styles.sessionText}>
              <span className={styles.label}>{run.name}</span>
              <RunMeta run={run} />
            </span>
            {run.session === null && run.state === "running" ? (
              <TabStateDot dot="working" />
            ) : null}
          </div>
          {run.session === null ? null : (
            <ul className={`${styles.list} ${styles.sessions}`} role="list">
              <SessionItem session={run.session} onSession={onSession} />
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
