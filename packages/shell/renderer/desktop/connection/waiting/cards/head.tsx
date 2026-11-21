// 카드 머리: 얼굴, 제목, 한 줄 설명, 누가 어느 session에서 어느 앱·project에 대해 청했는지, 시각.
// 세부가 있으면 오른쪽 끝에 펼침 토글이 있다. 토글 위치는 카드마다 같다.

import { IconButton } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import {
  type AgentId,
  isLophn,
} from "../../../../../../protocol/lophn-agent/workspaces.ts";
import { commonIcons } from "../../../../icons/mod.ts";
import {
  Avatar,
  type AvatarProfile,
} from "../../../../parts/avatar/avatar.tsx";
import type { CardView } from "../model.ts";
import styles from "../waiting.module.css";

// 카드는 정의를 읽지 않는다. lophn(또는 모르는 쪽)과 그 밖의 agent 두 얼굴뿐이다.
const LOPHN_FACE = {
  kind: "character",
  shape: "square",
  color: "coral",
} as const;
const AGENT_FACE = { kind: "character", shape: "arch", color: "sage" } as const;

function faceOf(agent: AgentId | null): AvatarProfile {
  return agent === null || isLophn(agent) ? LOPHN_FACE : AGENT_FACE;
}

export function Head({
  view,
  agent,
  toggle,
}: {
  view: CardView;
  agent: AgentId | null;
  toggle?: { open: boolean; onToggle: () => void };
}) {
  return (
    <div className={styles.who}>
      <span className={styles.face}>
        <Avatar profile={faceOf(agent)} size="sm" />
      </span>
      <div className={styles.whoText}>
        <p className={styles.title}>{view.title}</p>
        <p className={styles.desc}>{view.description}</p>
        <span className={styles.meta}>{view.meta}</span>
      </div>
      <div
        className={styles.side}
        data-slot={toggle === undefined || undefined}
      >
        {view.machine === undefined ? null : (
          <span className={styles.machine} data-machine-tag="">
            {view.machine}
          </span>
        )}
        <span className={styles.age}>{view.age}</span>
        {toggle === undefined ? null : (
          <IconButton
            icon={toggle.open ? commonIcons.collapse : commonIcons.expand}
            label={
              toggle.open
                ? t("waiting.label.hide-details")
                : t("waiting.label.show-details")
            }
            size="sm"
            aria-expanded={toggle.open}
            onClick={toggle.onToggle}
          />
        )}
      </div>
    </div>
  );
}
