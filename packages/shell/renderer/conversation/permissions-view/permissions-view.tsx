// `/permissions`가 대화 화면 안 panel로 열고, 입력칸 아래 권한 요약이 popover 안에 여는 같은 보기. 그 agent에
// 할당한 앱과 앱마다 뺀 tool만 보인다. MCP server는 설정한 층이 할당이라 줄 대신 설정한 곳을 가리키는 한
// 줄이다. 고치기는 Agents 화면에서 한다.
import type { ReactElement } from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import { actionIcons, workspaceIcons } from "../../icons/mod.ts";
import type { PermissionsView as PermissionsData } from "../agent-tab-source.ts";
import styles from "./permissions-view.module.css";

interface PermissionsViewProps {
  agent: string;
  permissions: PermissionsData;
  /** panel을 닫는다. popover 안에서는 두지 않는다. */
  onClose?: () => void;
  /** [Edit in Agents]. host가 Agents 화면을 연다. */
  onEdit: () => void;
  /** popover 안에서는 제목줄과 바깥 테두리를 줄인다. */
  popover?: boolean;
}

export function PermissionsView({
  agent,
  permissions,
  onClose,
  onEdit,
  popover = false,
}: PermissionsViewProps): ReactElement {
  return (
    <section
      className={popover ? styles.popover : styles.panel}
      aria-label={t("conversation.label.permissions-of", { agent })}
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
        <div className={styles.group}>
          <p className={styles.groupHead}>
            {t("conversation.label.permissions-may", { agent })}
          </p>
          {permissions.apps.length === 0 ? (
            <p className={styles.muted}>
              {t("conversation.notice.permissions-no-apps")}
            </p>
          ) : (
            <ul className={styles.list}>
              {permissions.apps.map((app) => (
                <li key={app.name} className={styles.row}>
                  <span className={styles.target}>{app.name}</span>
                  <span className={styles.effect}>
                    {app.removed.length === 0
                      ? t("conversation.label.permissions-all-tools")
                      : t("conversation.label.permissions-except", {
                          tools: app.removed.join(", "),
                        })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.muted}>
            {t("conversation.notice.permissions-mcp")}
          </p>
        </div>
      </div>
      <footer className={styles.foot}>
        <p className={styles.note}>
          {t("conversation.notice.permissions-edited-in-agents")}
        </p>
        <Button size="sm" icon={actionIcons.edit} onClick={onEdit}>
          {t("conversation.button.permissions-edit")}
        </Button>
      </footer>
    </section>
  );
}
