// `/permissions`가 대화 화면 안 panel로 열고, 입력칸 아래 권한 요약이 popover 안에 여는 같은 보기. 그 agent의
// agent grant(대상, 효과, 묻는지)와 이 session에서 "이 session 동안"으로 허락한 대상만 보인다. 고치기는
// Agents 화면에서 한다.
import type { ReactElement } from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { t } from "@lophn/wording";
import { workspaceIcons } from "../../icons/mod.ts";
import type {
  GrantSetting,
  PermissionsView as PermissionsData,
} from "../agent-tab-source.ts";
import styles from "./permissions-view.module.css";

const SETTINGS = {
  allow: "conversation.label.grant-allow",
  ask: "conversation.label.grant-ask",
  deny: "conversation.label.grant-deny",
} as const satisfies Record<GrantSetting, string>;

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

export function PermissionsView(
  { agent, permissions, onClose, onEdit, popover = false }:
    PermissionsViewProps,
): ReactElement {
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
          <ul className={styles.list}>
            {permissions.grants.map((row) => (
              <li key={`${row.target}-${row.effect}`} className={styles.row}>
                <span className={styles.target}>{row.target}</span>
                <span className={styles.effect}>{row.effect}</span>
                <span className={styles.setting} data-setting={row.setting}>
                  {t(SETTINGS[row.setting])}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.group}>
          <p className={styles.groupHead}>
            {t("conversation.label.permissions-session")}
          </p>
          {permissions.session.length === 0
            ? (
              <p className={styles.muted}>
                {t("conversation.notice.permissions-session-empty")}
              </p>
            )
            : (
              <ul className={styles.list}>
                {permissions.session.map((target) => (
                  <li key={target} className={styles.row}>
                    <span className={styles.target}>{target}</span>
                    <span className={styles.setting}>
                      {t("conversation.label.grant-allow")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          <p className={styles.muted}>
            {t("conversation.notice.permissions-session-ends")}
          </p>
        </div>
      </div>
      <footer className={styles.foot}>
        <p className={styles.note}>
          {t("conversation.notice.permissions-edited-in-agents")}
        </p>
        <Button size="sm" onClick={onEdit}>
          {t("conversation.button.permissions-edit")}
        </Button>
      </footer>
    </section>
  );
}
