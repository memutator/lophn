// git 쓰기·hook 오류 카드(spec 5.1.8): 요약 한 줄, reason마다 복구 안내, 자격증명을 가린 stderr를 접어 보이기, 인증 실패 명령 복사.
import { en, type MessageKey, t } from "@lophn/i18n";
import { CopyButton, IconButton } from "@lophn/ui/primitives";
import { systemClipboard } from "@lophn/ui/shared";
import { workspaceIcons } from "../../icons/mod.ts";
import type { GitFailure } from "../worktrees/source.ts";
import styles from "./source-control.module.css";

const STDERR_MAX = 16 * 1024;

export function hintOf(failure: GitFailure): string | null {
  const key = `source-control.hint.${failure.reason ?? failure.code}`;
  return key in en ? t(key as MessageKey) : null;
}

function markersOf(failure: GitFailure): string[] {
  const markers = failure.details?.markers;
  if (!Array.isArray(markers)) return [];
  return markers.flatMap((one) => {
    const item = one as { path?: unknown; line?: unknown };
    return typeof item.path === "string"
      ? [
          typeof item.line === "number"
            ? t("source-control.label.error-line", {
                path: item.path,
                line: item.line,
              })
            : item.path,
        ]
      : [];
  });
}

function listOf(failure: GitFailure, field: "paths" | "files"): string[] {
  const value = failure.details?.[field];
  return Array.isArray(value)
    ? value.filter((one): one is string => typeof one === "string")
    : [];
}

export function ErrorCard({
  failure,
  onDismiss,
}: {
  failure: GitFailure;
  onDismiss?: () => void;
}) {
  const hint = hintOf(failure);
  const items = [
    ...markersOf(failure),
    ...(failure.reason === "conflict_markers" ? [] : listOf(failure, "files")),
    ...listOf(failure, "paths"),
  ];
  const summary = failure.message.split(/\r?\n/)[0] ?? failure.message;
  const stderr =
    failure.stderr === undefined
      ? null
      : failure.stderr.length > STDERR_MAX
        ? failure.stderr.slice(0, STDERR_MAX)
        : failure.stderr;
  return (
    <div
      className={styles.errorCard}
      role="alert"
      data-sc-error={failure.reason ?? failure.code}
    >
      <div className={styles.errorHead}>
        <span className={styles.errorSummary}>{hint ?? summary}</span>
        {onDismiss === undefined ? null : (
          <IconButton
            size="sm"
            icon={workspaceIcons.close}
            label={t("source-control.button.dismiss")}
            onClick={onDismiss}
          />
        )}
      </div>
      {items.length === 0 ? null : (
        <ul className={styles.errorList}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {failure.command === undefined ? null : (
        <div className={styles.errorCommand}>
          <code>{failure.command}</code>
          <CopyButton
            text={failure.command}
            label={t("source-control.button.copy-command")}
            clipboard={systemClipboard}
          />
        </div>
      )}
      {stderr === null && hint === null ? null : (
        <details className={styles.errorDetails}>
          <summary>{t("source-control.label.error-details")}</summary>
          {hint === null ? null : <p>{summary}</p>}
          {stderr === null ? null : <pre>{stderr}</pre>}
        </details>
      )}
    </div>
  );
}
