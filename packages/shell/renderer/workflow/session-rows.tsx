// workflow가 연 session들을 spawn tree로 보인다. 줄마다 agent의 얼굴과 이름, 지금 상태, 마지막 말의 앞부분, 실패 이유, [Open session]이 있다.
// run 화면이 step마다 그 step의 session을 이 줄로 붙인다.
import { Button, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { type MessageKey, t } from "@lophn/i18n";

import { actionIcons, editorIcons } from "../icons/mod.ts";
import { Avatar } from "../parts/avatar/avatar.tsx";
import type { WorkflowSessionNodeView } from "../workspace/source.ts";
import {
  type FaceOf,
  previewText,
  type SessionNodeStatus,
  type SessionTreeRow,
  sessionFace,
} from "./model.ts";
import styles from "./session-rows.module.css";

const SESSION_STATE_KEY: Record<SessionNodeStatus, MessageKey> = {
  running: "workflow.label.session-state-running",
  waiting: "workflow.label.session-state-waiting",
  idle: "workflow.label.session-state-idle",
  failed: "workflow.label.session-state-failed",
};

export function SessionRows({
  rows,
  faceOf,
  openerOf,
  workspaceNameOf,
}: {
  rows: readonly SessionTreeRow[];
  faceOf: FaceOf | undefined;
  /** 열 수 있는 session이면 여는 함수, 아니면 null. */
  openerOf: (session: string) => (() => void) | null;
  /** run의 project가 아닌 곳에서 도는 session의 workspace 이름. 모르면 undefined다. */
  workspaceNameOf: (
    workspace: NonNullable<WorkflowSessionNodeView["workspace"]>,
  ) => string | undefined;
}) {
  return (
    <ul className={styles.sessions}>
      {rows.map(({ node, depth, status }) => {
        const open = openerOf(node.session);
        const preview = previewText(node.last_assistant_preview);
        const face = sessionFace(node, faceOf);
        const waitingLabel =
          node.waiting_for === "approval"
            ? t("workflow.label.session-waiting-approval")
            : node.waiting_for === "question"
              ? t("workflow.label.session-waiting-question")
              : null;
        const workspace =
          node.workspace === null ? undefined : workspaceNameOf(node.workspace);
        return (
          <li
            key={node.session}
            className={styles.row}
            data-session-node={node.session}
            data-session-state={status}
            data-depth={Math.min(depth, 4)}
          >
            <span className={styles.face}>
              <Avatar size="sm" look={face.avatar} />
            </span>
            <div className={styles.main}>
              <div className={styles.head}>
                <span className={styles.agent}>{face.name}</span>
                <span className={styles.state}>
                  <span className={styles.dot} aria-hidden="true" />
                  {waitingLabel ?? t(SESSION_STATE_KEY[status])}
                </span>
                {workspace === undefined ? null : (
                  <span className={styles.workspace}>{workspace}</span>
                )}
              </div>
              {preview === null ? null : (
                <p className={styles.preview}>{preview}</p>
              )}
              {node.last_error === null ? null : (
                <p className={styles.error} data-session-error="">
                  <Icon
                    icon={editorIcons.problem}
                    pixels={iconPixels("base")}
                  />
                  <span>{node.last_error}</span>
                </p>
              )}
            </div>
            {open === null ? null : (
              <span className={styles.action}>
                <Button
                  size="sm"
                  variant="ghost"
                  trailingIcon={actionIcons.open}
                  onClick={open}
                  data-session-open={node.session}
                >
                  {t("workflow.button.open-session")}
                </Button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
