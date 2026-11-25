// 대화 타임라인의 "막힘" 블록. 권한·범위·모드·정책으로 막힌 tool 호출을 일반 실패와 구별해 보이고,
// recovery_action이 있을 때만 복구 단추를 둔다. 단추는 상태만 바꾸고 도구를 자동으로 다시 돌리지 않는다.
import { type MessageKey, t } from "@lophn/i18n";
import { StatusMark } from "@lophn/ui/feedback";
import { Button } from "@lophn/ui/primitives";
import { type ReactElement, useState } from "react";
import type {
  PermissionDenial,
  RecoveryAction,
} from "../../../../protocol/approvals/denial.ts";
import type { PermissionMode } from "../../../../protocol/lophn-agent/turn-values.ts";
import { actionIcons } from "../../icons/mod.ts";
import styles from "./thread.module.css";

const MODE_LABEL: Record<PermissionMode, MessageKey> = {
  read_only: "conversation.label.mode-read_only",
  ask: "conversation.label.mode-ask",
  workspace: "conversation.label.mode-workspace",
  full: "conversation.label.mode-full",
};

export function modeLabelText(mode: PermissionMode): string {
  return t(MODE_LABEL[mode]);
}

export function recoveryLabel(action: RecoveryAction): string | null {
  switch (action.kind) {
    case "none":
      return null;
    case "edit_rule":
      return t("conversation.button.recover-edit-rule");
    case "assign_app":
      return t("conversation.button.recover-assign-app");
    case "change_mode":
      return action.suggested_mode === undefined
        ? t("conversation.button.recover-change-mode-generic")
        : t("conversation.button.recover-change-mode", {
            mode: modeLabelText(action.suggested_mode),
          });
    case "trust_local_tool":
      return t("conversation.button.recover-trust-local-tool");
    case "trust_mcp":
      return t("conversation.button.recover-trust-mcp");
    case "add_allow_rule":
      return t("conversation.button.recover-add-allow-rule");
    case "sign_in_mcp":
      return t("conversation.button.recover-sign-in-mcp");
  }
}

interface PermissionDeniedBlockProps {
  readonly toolCall: string;
  readonly denial: PermissionDenial;
  readonly onRecover?:
    | ((action: RecoveryAction) => Promise<boolean>)
    | undefined;
}

export function PermissionDeniedBlock({
  toolCall,
  denial,
  onRecover,
}: PermissionDeniedBlockProps): ReactElement {
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">(
    "idle",
  );
  const action = denial.recovery_action;
  const label =
    action !== null && action.kind !== "none" ? recoveryLabel(action) : null;

  const run = async () => {
    if (action === null || onRecover === undefined) return;
    setState("busy");
    const ok = await onRecover(action);
    setState(ok ? "done" : "failed");
  };

  return (
    <div
      className={styles.blocked}
      role="status"
      data-permission-denied={toolCall}
      data-reason-kind={denial.reason_kind}
    >
      <div className={styles.blockedText}>
        <div className={styles.blockedHead}>
          <StatusMark tone="warning" label={t("conversation.label.blocked")} />
          <span className={styles.blockedTarget}>
            {denial.tool} · {denial.target_summary}
          </span>
        </div>
        <p className={styles.blockedReason}>{denial.message}</p>
        {denial.rule_pattern === null ? null : (
          <p className={styles.blockedRule}>
            <code>
              {t("conversation.label.blocked-rule", {
                pattern: denial.rule_pattern,
              })}
            </code>
          </p>
        )}
        {state === "done" ? (
          <p className={styles.blockedNote} data-recovery-done="">
            {t("conversation.notice.recover-done")}
          </p>
        ) : state === "failed" ? (
          <p className={styles.blockedError} data-recovery-failed="">
            {t("conversation.notice.recover-failed")}
          </p>
        ) : null}
      </div>
      {label !== null && onRecover !== undefined ? (
        <Button
          size="sm"
          variant="secondary"
          icon={actionIcons.edit}
          disabled={state === "busy"}
          data-recovery-action={action!.kind}
          onClick={() => void run()}
        >
          {label}
        </Button>
      ) : null}
    </div>
  );
}
