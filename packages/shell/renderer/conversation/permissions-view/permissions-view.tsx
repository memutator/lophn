// `/permissions`가 대화 화면 안 panel로 열고, 입력칸 아래 권한 요약이 popover 안에 여는 5개 섹션 보기.
// 1. 현재 권한 단계 + 빠른 단계 고르기
// 2. 읽기·쓰기 폴더(등록 workspace 폴더 + 이번 대화에 연 바깥 폴더)
// 3. 규칙 요약(floor 수, 전역·project 규칙, 이번 대화 허락과 개별 해제)
// 4. 할당 앱(command별 ask 표시)·MCP 서버(신뢰 여부)·로컬 tool(신뢰 여부 + 해제/신뢰)
// 5. 최근 거부(이유, 걸린 규칙, 복구 단추)
import { t } from "@lophn/i18n";
import { Field, Select } from "@lophn/ui/input";
import { Button, IconButton } from "@lophn/ui/primitives";
import { type ReactElement, useState } from "react";
import type { RecoveryAction } from "../../../../protocol/approvals/denial.ts";
import {
  PERMISSION_MODES,
  type PermissionMode,
} from "../../../../protocol/lophn-agent/turn-values.ts";
import { actionIcons, workspaceIcons } from "../../icons/mod.ts";
import type { PermissionsView as PermissionsData } from "../agent-tab-source.ts";
import { modeLabelText, recoveryLabel } from "../thread/permission-denied.tsx";
import styles from "./permissions-view.module.css";

interface PermissionsViewProps {
  agent: string;
  permissions: PermissionsData;
  /** panel을 닫는다. popover 안에서는 두지 않는다. */
  onClose?: () => void;
  /** [Edit in Agents]. host가 Agents 화면을 연다. 없는 창에는 단추가 없다. */
  onEdit?: () => void;
  /** [Edit rules]. Settings › Permission rules로 간다. */
  onOpenRules?: () => void;
  /** 단계 빠른 고르기. */
  onChangeMode?: (mode: PermissionMode) => Promise<boolean>;
  /** 이번 대화 허락 개별 해제. */
  onRevokeGrant?: (grantId: string) => Promise<boolean>;
  /** 로컬 tool 신뢰/신뢰 해제. */
  onTrustLocalTool?: (path: string, sha256: string) => Promise<boolean>;
  onUntrustLocalTool?: (path: string) => Promise<boolean>;
  /** 최근 거부의 복구 단추. */
  onRecoverDenial?: (action: RecoveryAction) => Promise<boolean>;
  /** popover 안에서는 제목줄과 바깥 테두리를 줄인다. */
  popover?: boolean;
}

export function PermissionsView({
  agent,
  permissions,
  onClose,
  onEdit,
  onOpenRules,
  onChangeMode,
  onRevokeGrant,
  onTrustLocalTool,
  onUntrustLocalTool,
  onRecoverDenial,
  popover = false,
}: PermissionsViewProps): ReactElement {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const session = permissions.session;

  async function runBusy(
    key: string,
    fn: (() => Promise<boolean>) | undefined,
  ): Promise<void> {
    if (fn === undefined) return;
    setBusyKey(key);
    await fn();
    setBusyKey(null);
  }

  const modeOptions =
    session === undefined
      ? []
      : PERMISSION_MODES.map((mode) => ({
          value: mode,
          label: modeLabelText(mode),
        }));

  return (
    <section
      className={popover ? styles.popover : styles.panel}
      aria-label={t("conversation.label.permissions-of", { agent })}
      data-permissions-view=""
    >
      <header className={styles.head}>
        <span className={styles.title}>
          {t("conversation.title.permissions", { agent })}
        </span>
        {onClose === undefined ? null : (
          <IconButton
            icon={workspaceIcons.close}
            label={t("common.button.close")}
            size="sm"
            onClick={onClose}
          />
        )}
      </header>
      <div className={styles.body}>
        {/* 1. 현재 권한 단계 */}
        {session === undefined ? null : (
          <div className={styles.group} data-permissions-section="mode">
            <p className={styles.groupHead}>
              {t("conversation.heading.permissions-mode")}
            </p>
            <div className={styles.modeRow}>
              <span
                className={
                  session.mode === "full"
                    ? `${styles.badge} ${styles.badgeWarning}`
                    : styles.badge
                }
                data-current-mode={session.mode}
              >
                {modeLabelText(session.mode)}
              </span>
              {onChangeMode !== undefined && modeOptions.length > 1 ? (
                <div className={styles.modeSelect}>
                  <Field label={t("conversation.heading.permissions-mode")}>
                    <Select
                      options={modeOptions}
                      value={session.mode}
                      disabled={busyKey === "mode"}
                      onValueChange={(next) => {
                        const mode = next as PermissionMode;
                        if (mode !== session.mode) {
                          void runBusy("mode", () => onChangeMode(mode));
                        }
                      }}
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* 2. 읽기·쓰기 폴더 */}
        {session === undefined ? null : (
          <div className={styles.group} data-permissions-section="folders">
            <p className={styles.groupHead}>
              {t("conversation.heading.permissions-folders")}
            </p>
            {session.workspace_folders.length === 0 &&
            session.opened_folders.length === 0 ? (
              <p className={styles.muted}>
                {t("conversation.empty.permissions-folders")}
              </p>
            ) : (
              <ul className={styles.list}>
                {session.workspace_folders.map((folder) => (
                  <li key={`ws:${folder}`} className={styles.row}>
                    <span className={styles.mono}>{folder}</span>
                    <span className={styles.badge}>
                      {t("conversation.label.permissions-folders-workspace")}
                    </span>
                  </li>
                ))}
                {session.opened_folders.map((folder) => (
                  <li key={`open:${folder}`} className={styles.row}>
                    <span className={styles.mono}>{folder}</span>
                    <span className={styles.badge}>
                      {t("conversation.label.permissions-folders-opened")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 3. 규칙 요약 + 이번 대화 허락 */}
        {session === undefined ? null : (
          <div className={styles.group} data-permissions-section="rules">
            <div className={styles.groupHeadRow}>
              <p className={styles.groupHead}>
                {t("conversation.heading.permissions-rules")}
              </p>
              {onOpenRules === undefined ? null : (
                <Button size="sm" variant="ghost" onClick={onOpenRules}>
                  {t("conversation.button.permissions-open-rules")}
                </Button>
              )}
            </div>
            <div className={styles.summaryLine}>
              <span className={styles.badge}>
                {t("conversation.label.permissions-floor-count", {
                  count: session.floor_count,
                })}
              </span>
              <span className={styles.badge}>
                {t("conversation.label.permissions-global-rules", {
                  count: session.global_rules.length,
                })}
              </span>
              <span className={styles.badge}>
                {t("conversation.label.permissions-project-rules", {
                  count: session.project_rules.length,
                })}
              </span>
            </div>
            <p className={styles.subHead}>
              {t("conversation.label.permissions-session-grants", {
                count: session.session_grants.length,
              })}
            </p>
            {session.session_grants.length === 0 ? (
              <p className={styles.muted}>
                {t("conversation.empty.permissions-session-grants")}
              </p>
            ) : (
              <ul className={styles.list}>
                {session.session_grants.map((grant) => (
                  <li
                    key={grant.id}
                    className={styles.row}
                    data-session-grant={grant.id}
                  >
                    <span className={styles.target}>
                      <span className={styles.mono}>{grant.pattern}</span>
                      <span className={styles.muted}> · {grant.label}</span>
                    </span>
                    {onRevokeGrant === undefined ? null : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyKey === `grant:${grant.id}`}
                        data-revoke-grant={grant.id}
                        onClick={() =>
                          void runBusy(`grant:${grant.id}`, () =>
                            onRevokeGrant(grant.id),
                          )
                        }
                      >
                        {t("conversation.button.permissions-revoke")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 4. 할당 앱, MCP & 로컬 tool */}
        <div className={styles.group} data-permissions-section="tools">
          <p className={styles.groupHead}>
            {session === undefined
              ? t("conversation.label.permissions-may", { agent })
              : t("conversation.heading.permissions-tools")}
          </p>
          {permissions.apps.length === 0 ? (
            <p className={styles.muted}>
              {t("conversation.notice.permissions-no-apps")}
            </p>
          ) : (
            <ul className={styles.list}>
              {permissions.apps.map((app) => {
                const askTools = app.ask ?? [];
                return (
                  <li key={app.name} className={styles.row}>
                    <span className={styles.target}>{app.name}</span>
                    <span className={styles.effect}>
                      {app.removed.length === 0
                        ? t("conversation.label.permissions-all-tools")
                        : t("conversation.label.permissions-except", {
                            tools: app.removed.join(", "),
                          })}
                      {askTools.length > 0
                        ? ` · ${t("conversation.label.permissions-ask-tools", {
                            tools: askTools.join(", "),
                          })}`
                        : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {session !== undefined && session.mcp_servers.length > 0 ? (
            <ul className={styles.list}>
              {session.mcp_servers.map((server) => (
                <li
                  key={`mcp:${server.name}`}
                  className={styles.row}
                  data-mcp-server={server.name}
                >
                  <span className={styles.target}>MCP · {server.name}</span>
                  <span
                    className={
                      server.trust === "trusted"
                        ? `${styles.badge} ${styles.badgeGood}`
                        : styles.badge
                    }
                    data-mcp-trust={server.trust}
                  >
                    {t(
                      server.trust === "trusted"
                        ? "conversation.label.permissions-mcp-trusted"
                        : "conversation.label.permissions-mcp-untrusted",
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>
              {t("conversation.notice.permissions-mcp")}
            </p>
          )}
          {session !== undefined && session.local_tools.length > 0 ? (
            <ul className={styles.list}>
              {session.local_tools.map((tool) => (
                <li
                  key={`local:${tool.path}`}
                  className={styles.row}
                  data-local-tool={tool.name}
                >
                  <span className={styles.target}>
                    {tool.name}
                    <span className={styles.muted}> · {tool.path}</span>
                  </span>
                  <span className={styles.rowActions}>
                    <span
                      className={
                        tool.trusted
                          ? `${styles.badge} ${styles.badgeGood}`
                          : styles.badge
                      }
                    >
                      {t(
                        tool.trusted
                          ? "conversation.label.permissions-local-trusted"
                          : "conversation.label.permissions-local-untrusted",
                      )}
                    </span>
                    {tool.trusted && onUntrustLocalTool !== undefined ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyKey === `untrust:${tool.path}`}
                        data-untrust-local-tool={tool.name}
                        onClick={() =>
                          void runBusy(`untrust:${tool.path}`, () =>
                            onUntrustLocalTool(tool.path),
                          )
                        }
                      >
                        {t("conversation.button.permissions-untrust")}
                      </Button>
                    ) : !tool.trusted && onTrustLocalTool !== undefined ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyKey === `trust:${tool.path}`}
                        data-trust-local-tool={tool.name}
                        onClick={() =>
                          void runBusy(`trust:${tool.path}`, () =>
                            onTrustLocalTool(tool.path, tool.sha256),
                          )
                        }
                      >
                        {t("conversation.button.permissions-trust")}
                      </Button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* 5. 최근 거부 */}
        {session === undefined ? null : (
          <div className={styles.group} data-permissions-section="denials">
            <p className={styles.groupHead}>
              {t("conversation.heading.permissions-denials")}
            </p>
            {session.recent_denials.length === 0 ? (
              <p className={styles.muted}>
                {t("conversation.empty.permissions-denials")}
              </p>
            ) : (
              <ul className={styles.list}>
                {session.recent_denials.map((item) => {
                  const action = item.denial.recovery_action;
                  const label =
                    action !== null && action.kind !== "none"
                      ? recoveryLabel(action)
                      : null;
                  return (
                    <li
                      key={item.id}
                      className={styles.denialRow}
                      data-recent-denial={item.id}
                    >
                      <div className={styles.denialMain}>
                        <span className={styles.target}>
                          {item.denial.tool} · {item.denial.target_summary}
                        </span>
                        <span className={styles.muted}>
                          {item.denial.message}
                        </span>
                        {item.denial.rule_pattern === null ? null : (
                          <code className={styles.mono}>
                            {t("conversation.label.blocked-rule", {
                              pattern: item.denial.rule_pattern,
                            })}
                          </code>
                        )}
                      </div>
                      {label !== null && onRecoverDenial !== undefined ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyKey === `recover:${item.id}`}
                          onClick={() =>
                            void runBusy(`recover:${item.id}`, () =>
                              onRecoverDenial(action!),
                            )
                          }
                        >
                          {label}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
      <footer className={styles.foot}>
        <p className={styles.note}>
          {t("conversation.notice.permissions-edited-in-agents")}
        </p>
        {onEdit === undefined ? null : (
          <Button size="sm" icon={actionIcons.edit} onClick={onEdit}>
            {t("conversation.button.permissions-edit")}
          </Button>
        )}
      </footer>
    </section>
  );
}
