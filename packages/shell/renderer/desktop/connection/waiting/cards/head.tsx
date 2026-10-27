// 카드 머리: 얼굴, 제목, 한 줄 설명, 누가 어느 session에서 어느 앱·project에 대해 청했는지, 시각.
// 세부가 있으면 오른쪽 끝에 펼침 토글이 있다. 토글 위치는 카드마다 같다.

import { IconButton } from "@lophn/ui/primitives";
import { t } from "@lophn/wording";
import type { CallAgent } from "../../../../../../protocol/lophn-agent/calls.ts";
import { commonIcons } from "../../../../icons/mod.ts";
import {
  Avatar,
  type AvatarProfile,
} from "../../../../parts/avatar/avatar.tsx";
import type { CardView } from "../model.ts";
import styles from "../waiting.module.css";

const FACES = {
  lophn: { kind: "character", shape: "square", color: "coral" },
  operator: { kind: "character", shape: "arch", color: "sage" },
  project_manager: { kind: "character", shape: "capsule", color: "periwinkle" },
  app_engineer: { kind: "character", shape: "wide", color: "yellow" },
  coding_agent: { kind: "character", shape: "pear", color: "teal" },
} as const;

function faceOf(
  agent: CallAgent | null,
  kind: CardView["kind"],
): AvatarProfile {
  return agent !== null
    ? FACES[agent.role]
    : kind === "activation"
      ? FACES.app_engineer
      : FACES.lophn;
}

export function Head({
  view,
  agent,
  toggle,
}: {
  view: CardView;
  agent: CallAgent | null;
  toggle?: { open: boolean; onToggle: () => void };
}) {
  return (
    <div className={styles.who}>
      <span className={styles.face}>
        <Avatar profile={faceOf(agent, view.kind)} size="sm" />
      </span>
      <div className={styles.whoText}>
        <p className={styles.title}>{view.title}</p>
        <p className={styles.desc}>{view.description}</p>
        <span className={styles.meta}>{view.meta}</span>
      </div>
      <div className={styles.side}>
        <span className={styles.age}>{view.age}</span>
        {toggle === undefined ? (
          <span className={styles.slot} />
        ) : (
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
