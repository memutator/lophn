// `/permissions`와 입력칸 아래 권한 요약이 같이 여는 보기. 그 agent의 agent grant와, 이 session에서 "이 session 동안"으로
// 허락한 대상을 보인다. 고치기는 Agents 화면에서 한다.
import { Button, IconButton } from "@lophn/design/components";
import { workspaceIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";

import { GRANTS, SESSION_ALLOWED, SETTING_TEXT } from "./data.ts";
import t from "./agent-tab.module.css";

export function PermissionsView(
  { agent, onClose, popover = false }: {
    agent: string;
    onClose?: () => void;
    /** popover 안에서는 틀(제목줄, 바깥 테두리)을 줄인다. */
    popover?: boolean;
  },
) {
  return (
    <section
      className={popover ? t.permsPop : t.panel}
      aria-label={`Permissions of ${agent}`}
    >
      <header className={t.panelHead}>
        <span className={t.panelTitle}>Permissions · {agent}</span>
        {onClose === undefined ? null : (
          <IconButton
            icon={workspaceIcons.close}
            label="Close permissions"
            size="sm"
            onClick={onClose}
          />
        )}
      </header>
      <div className={t.panelBody}>
        <div className={t.rewindGroup}>
          <p className={t.rewindHead}>What {agent} may do</p>
          <ul className={t.grantList}>
            {GRANTS.map((row) => (
              <li key={`${row.target}-${row.effect}`} className={t.grantRow}>
                <span className={t.grantTarget}>{row.target}</span>
                <span className={t.grantEffect}>{row.effect}</span>
                <span className={t.grantSetting} data-setting={row.setting}>
                  {SETTING_TEXT[row.setting]}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={t.rewindGroup}>
          <p className={t.rewindHead}>Allowed for this session</p>
          {SESSION_ALLOWED.length === 0
            ? <p className={t.rewindMuted}>Nothing yet.</p>
            : (
              <ul className={t.grantList}>
                {SESSION_ALLOWED.map((target) => (
                  <li key={target} className={t.grantRow}>
                    <span className={t.grantTarget}>{target}</span>
                    <span className={t.grantSetting}>Runs without asking</span>
                  </li>
                ))}
              </ul>
            )}
          <p className={t.rewindMuted}>
            These end when this session is archived or deleted.
          </p>
        </div>
      </div>
      <footer className={t.panelFoot}>
        <span className={t.cardNote}>Grants are edited in Agents.</span>
        <Button size="sm">Open Agents</Button>
      </footer>
    </section>
  );
}
