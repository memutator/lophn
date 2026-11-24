// step을 맡은 쪽의 얼굴. agent는 그 agent의 avatar, 사람과 program은 아이콘이다.
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";

import { commonIcons, editorIcons } from "../icons/mod.ts";
import { Avatar } from "../parts/avatar/avatar.tsx";
import { agentFace, type FaceOf, type Who, whoName } from "./model.ts";
import styles from "./who.module.css";

const ICON = {
  human: commonIcons.person,
  program: commonIcons.program,
  unknown: editorIcons.problem,
} as const;

export function WhoMark({
  who,
  faceOf,
}: {
  who: Who;
  faceOf: FaceOf | undefined;
}) {
  if (who.kind === "agent") {
    const face = agentFace(who.handle, faceOf);
    return (
      <Avatar
        size="sm"
        look={
          face?.avatar ?? {
            kind: "initial",
            text: who.handle.slice(0, 1).toUpperCase(),
          }
        }
        label={whoName(who, faceOf)}
      />
    );
  }
  return (
    <span className={styles.mark} data-who={who.kind}>
      <Icon icon={ICON[who.kind]} pixels={iconPixels("base")} />
    </span>
  );
}
