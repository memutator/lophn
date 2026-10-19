// 카드 머리: 얼굴, 제목, 한 줄 설명, 누가 어느 session에서 어느 앱·project에 대해 청했는지, 시각.
// 세부가 있으면 오른쪽 끝에 펼침 토글이 있다. 토글 위치는 카드마다 같다.
import {
  Avatar,
  type AvatarProfile,
} from "../../../../parts/avatar/avatar.tsx";
import { IconButton } from "@lophn/ui/primitives";
import { t } from "@lophn/wording";
import type { CallAgent } from "../../../../../../protocol/lophn-agent/calls.ts";
import { commonIcons } from "../../../../icons/mod.ts";
import type { CardView } from "../model.ts";
import styles from "../waiting.module.css";

const FACES = {
  lophn: "dock",
  operator: "search",
  project_manager: "roles",
  coding_agent: "terminal",
} as const;

function faceOf(
  agent: CallAgent | null,
  kind: CardView["kind"],
): AvatarProfile {
  const icon = agent !== null
    ? FACES[agent.role]
    : kind === "reaction"
    ? "compare"
    : "dock";
  return { kind: "icon", icon };
}

export function Head(
  { view, agent, toggle }: {
    view: CardView;
    agent: CallAgent | null;
    toggle?: { open: boolean; onToggle: () => void };
  },
) {
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
        {toggle === undefined ? <span className={styles.slot} /> : (
          <IconButton
            icon={toggle.open ? commonIcons.collapse : commonIcons.expand}
            label={toggle.open
              ? t("waiting.label.hide-details")
              : t("waiting.label.show-details")}
            size="sm"
            aria-expanded={toggle.open}
            onClick={toggle.onToggle}
          />
        )}
      </div>
    </div>
  );
}
