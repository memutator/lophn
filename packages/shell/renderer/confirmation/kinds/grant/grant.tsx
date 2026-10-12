import { t } from "@lophn/wording";

import type { Display } from "../../display.ts";
import { ApprovalDecision } from "../approval/approval.tsx";
import {
  appLabel,
  type ExactRow,
  ExactRows,
  facts,
  FoldedExact,
  type KindProps,
  list,
  obj,
  str,
} from "../exact.tsx";
import styles from "../kinds.module.css";

function title(kind: unknown, app: string): string {
  switch (kind) {
    case "fs.read":
      return t("confirmation-window.title.grant-fs-read", { app });
    case "fs.write":
      return t("confirmation-window.title.grant-fs-write", { app });
    case "net.fetch":
      return t("confirmation-window.title.grant-net-fetch", { app });
    case "net.listen":
      return t("confirmation-window.title.grant-net-listen", { app });
    case "secret.use":
      return t("confirmation-window.title.grant-secret-use", { app });
    case "document.save":
      return t("confirmation-window.title.grant-document-save", { app });
    case "app.call":
      return t("confirmation-window.title.grant-app-call", { app });
    case "agent.commands":
      return t("confirmation-window.title.grant-agent-commands", { app });
    default:
      return t("confirmation-window.approval.title");
  }
}

function effect(kind: unknown): string {
  switch (kind) {
    case "fs.read":
      return t("confirmation-window.grant-effect.fs-read");
    case "fs.write":
      return t("confirmation-window.grant-effect.fs-write");
    case "net.fetch":
      return t("confirmation-window.grant-effect.net-fetch");
    case "net.listen":
      return t("confirmation-window.grant-effect.net-listen");
    case "secret.use":
      return t("confirmation-window.grant-effect.secret-use");
    case "document.save":
      return t("confirmation-window.grant-effect.document-save");
    case "app.call":
      return t("confirmation-window.grant-effect.app-call");
    case "agent.commands":
      return t("confirmation-window.grant-effect.agent-commands");
    default:
      return t("confirmation-window.grant-effect.unknown");
  }
}

/** apps가 준 경고 key를 문구로. 모르는 key도 말없이 빼지 않고 있다고 말한다. */
function warning(key: unknown): string {
  switch (key) {
    case "permissions.warning.file-read-and-network":
      return t("confirmation-window.grant.warning-file-read-network");
    case "permissions.warning.outside-link":
      return t("confirmation-window.grant.warning-outside-link");
    default:
      return t("confirmation-window.grant.warning-unknown");
  }
}

function limit(key: unknown): string {
  switch (key) {
    case "permissions.limit.not-isolated":
      return t("confirmation-window.grant.limit-not-isolated");
    case "permissions.limit.granted-path-secrets":
      return t("confirmation-window.grant.limit-path-secrets");
    case "permissions.limit.symlink-changes":
      return t("confirmation-window.grant.limit-symlink");
    case "permissions.limit.cpu":
      return t("confirmation-window.grant.limit-cpu");
    case "permissions.limit.rss":
      return t("confirmation-window.grant.limit-rss");
    case "permissions.limit.disk":
      return t("confirmation-window.grant.limit-disk");
    default:
      return t("confirmation-window.grant.limit-unknown");
  }
}

/** 요청 범위의 원문. 경로·host·port·secret 이름·command를 줄이지 않고 고정폭으로 보인다. */
function scopeRows(
  kind: unknown,
  scope: Record<string, unknown>,
  target: string,
): ExactRow[] {
  const rows: ExactRow[] = [];
  const add = (key: string, label: string, value: unknown) => {
    if (value !== undefined && value !== null) {
      rows.push({ key, label, value: String(value) });
    }
  };
  if (kind === "fs.read" || kind === "fs.write") {
    add("path", t("confirmation-window.label.path"), scope.path);
    add(
      "recursive",
      t("confirmation-window.label.subfolders"),
      scope.recursive === true
        ? t("confirmation-window.label.yes")
        : t("confirmation-window.label.no"),
    );
  } else if (kind === "net.fetch" || kind === "net.listen") {
    add("host", t("confirmation-window.label.host"), scope.host);
    add("port", t("confirmation-window.label.port"), scope.port);
  } else if (kind === "secret.use") {
    add("name", t("confirmation-window.label.secret-name"), scope.name);
  } else if (kind === "document.save") {
    add("key", t("confirmation-window.label.document-key"), scope.key);
  } else if (kind === "app.call") {
    add("target", t("confirmation-window.label.target-app"), target);
  }
  if (kind === "app.call" || kind === "agent.commands") {
    add(
      "commands",
      t("confirmation-window.label.commands"),
      list(scope.commands).join("\n"),
    );
  }
  return rows;
}

/**
 * 접근·앱 쌍 허락. 요청 범위(정확한 경로·host·port·secret 이름, 앱 쌍은 부르는 앱 → 대상 앱과
 * command 범위)를 줄이지 않고 고정폭으로 보이고, 파일 읽기와 네트워크 조합 경고와 앱 보호의
 * 한계(apps 소유 key)를 함께 보인다.
 */
export function GrantKind(props: KindProps) {
  const shown = obj(props.view.view);
  const access = obj(shown.access);
  const kind = access.kind;
  const app = appLabel(shown.app);
  const requirement = obj(shown.requirement);
  const warnings = [
    ...list(shown.combination_warnings),
    ...(Array.isArray(requirement.warnings) ? requirement.warnings : []),
  ];
  const outside = list(requirement.outside_links);
  const limits = list(shown.limit_keys);
  const display: Display = {
    title: shown.operation === "revoke"
      ? t("confirmation-window.title.revoke-access", { app })
      : title(kind, app),
    subject: shown.operation === "revoke"
      ? t("confirmation-window.revoke.subject", { app })
      : t("confirmation-window.grant.subject", { app }),
    effect: shown.operation === "revoke"
      ? t("confirmation-window.revoke.effect")
      : effect(kind),
    reversible: shown.reversible === true,
    revertNote: str(shown.reversibility),
    action: shown.operation === "revoke"
      ? t("app-detail.button.remove-access")
      : t("confirmation-window.button.allow-access"),
    details: facts([
      [t("confirmation-window.label.requested-by"), str(shown.requester)],
      [t("confirmation-window.label.reason"), str(requirement.reason)],
      [t("confirmation-window.label.expires"), str(shown.expires_at)],
    ]),
    noChange: true,
  };
  return (
    <ApprovalDecision
      {...props}
      display={display}
      exact={
        <>
          {kind === "app.call"
            ? (
              <ExactRows
                rows={[{
                  key: "caller",
                  label: t("confirmation-window.label.app"),
                  value: app,
                }]}
              />
            )
            : null}
          <ExactRows
            rows={scopeRows(
              kind,
              obj(access.scope),
              appLabel(shown.target_app),
            )}
          />
          {requirement.granted === true
            ? (
              <p className={styles.message} data-grant="already">
                {t("confirmation-window.grant.already")}
              </p>
            )
            : null}
          {warnings.map((key) => (
            <p
              key={String(key)}
              className={styles.warning}
              role="note"
              data-warning={String(key)}
            >
              {warning(key)}
            </p>
          ))}
          {outside.length > 0
            ? (
              <ul className={styles.list} data-warning="outside-links">
                {outside.map((link) => (
                  <li key={link} className={`${styles.item} ${styles.mono}`}>
                    {link}
                  </li>
                ))}
              </ul>
            )
            : null}
          {limits.length > 0
            ? (
              <details className={styles.folded} data-grant="limits">
                <summary>{t("confirmation-window.label.limits")}</summary>
                <ul className={styles.list}>
                  {limits.map((key) => (
                    <li key={key} className={styles.item}>{limit(key)}</li>
                  ))}
                </ul>
              </details>
            )
            : null}
          <FoldedExact view={shown} />
        </>
      }
    />
  );
}
