// `RunList`(workspace/sidebar/run-list.tsx)의 마크업 복사본. 일반 run 줄과 job이 연 run 줄이 한 목록에 나란히 있다.
// job이 연 run은 이름 자리에 job 제목이 오고 둘째 줄은 "{agent 이름 또는 tool 이름} · {시각}"이다. avatar는 받은 agent
// 그대로다. 지워진 job의 옛 줄은 제목을 모르므로 일반 줄과 같다. 새 CSS 없이 기존 class만 쓴다.
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { formatRelativeTime, t } from "@lophn/wording";

import {
  Avatar,
  type AvatarProfile,
} from "../../../../packages/shell/renderer/parts/avatar/avatar.tsx";
import { settingsIcons } from "../../../../packages/shell/renderer/icons/mod.ts";
import { SessionItem } from "../../../../packages/shell/renderer/workspace/sidebar/run-list.tsx";
import styles from "../../../../packages/shell/renderer/workspace/sidebar/project-sidebar.module.css";
import {
  AGENT_NAMES,
  JOB_TITLES,
  OPERATOR_NAME,
  type RunRecordView,
  SESSION_TITLES,
} from "../../mock/jobs-origin-data.ts";

const FACES = {
  lophn: "dock",
  project_manager: "roles",
  app_engineer: "apps",
  operator: "search",
} as const;

interface Row {
  readonly record: RunRecordView;
  /** agent 이름 또는 tool 이름. */
  readonly name: string;
  readonly profile: AvatarProfile | null;
  /** job이 연 run이고 그 job이 아직 있으면 제목. */
  readonly jobTitle: string | null;
}

function rowOf(record: RunRecordView): Row {
  const jobTitle = record.job === null ? null : JOB_TITLES[record.job] ?? null;
  if ("tool" in record.target) {
    return { record, name: record.target.tool, profile: null, jobTitle };
  }
  const { role } = record.target.agent;
  return {
    record,
    name: role === "operator" ? OPERATOR_NAME : AGENT_NAMES[role],
    profile: { kind: "icon", icon: FACES[role] },
    jobTitle,
  };
}

// 이름 아래 줄. job 줄은 이름 뒤에 시각, 그 뒤에 failed·cancelled를 붙인다. done은 상태 표시가 없다.
function Meta({ row }: { row: Row }) {
  const when = formatRelativeTime(new Date(row.record.created_at), new Date());
  const state = row.record.state;
  return (
    <span className={styles.sessionMeta}>
      {row.jobTitle === null ? when : `${row.name} · ${when}`}
      {state === "failed" || state === "cancelled"
        ? (
          <>
            {" · "}
            <span className={styles.runState} data-tone={state}>
              {state === "failed"
                ? t("run-list.label.failed")
                : t("run-list.label.cancelled")}
            </span>
          </>
        )
        : null}
    </span>
  );
}

export function RunRows({ runs }: { runs: readonly RunRecordView[] }) {
  return (
    <ul className={styles.list} role="list">
      {runs.map(rowOf).map((row) => {
        const { record } = row;
        const session = record.session_opened && record.session !== null
          ? {
            id: record.session,
            title: SESSION_TITLES[record.session] ?? "",
            agent: "",
            status: record.state === "running"
              ? "working" as const
              : "idle" as const,
            open: true,
            at: Date.parse(record.created_at),
          }
          : null;
        return (
          <li
            key={record.id}
            className={styles.agentGroup}
            data-run={record.id}
            data-run-job={record.job ?? undefined}
          >
            <div className={`${styles.li} ${styles.runRow}`}>
              {row.profile === null
                ? (
                  <span className={styles.runIcon}>
                    <Icon
                      icon={settingsIcons.tools}
                      pixels={iconPixels("small")}
                    />
                  </span>
                )
                : <Avatar profile={row.profile} size="sm" />}
              <span className={styles.sessionText}>
                <span className={styles.label}>
                  {row.jobTitle ?? row.name}
                </span>
                <Meta row={row} />
              </span>
              {session === null && record.state === "running"
                ? <span className={styles.sessionDot} data-state="working" />
                : null}
            </div>
            {session === null
              ? null
              : (
                <ul className={`${styles.list} ${styles.sessions}`} role="list">
                  <SessionItem
                    session={session}
                    hideWhen
                    onSession={() => {}}
                  />
                </ul>
              )}
          </li>
        );
      })}
    </ul>
  );
}
