// run의 상태를 아이콘과 글로 보인다. 색은 거들 뿐이다.
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import { commonIcons, editorIcons } from "../icons/mod.ts";
import { DESKTOP_STATE_KEY, type DesktopShown } from "./model.ts";
import styles from "./state-mark.module.css";

const STATE_ICON = {
  running: commonIcons.stateRunning,
  human: commonIcons.stateYourTurn,
  blocked: editorIcons.problem,
  ended: commonIcons.stateEnded,
  stopped: commonIcons.stateStopped,
} as const;

export function StateMark({ shown }: { shown: DesktopShown }) {
  return (
    <span className={styles.stateMark} data-shown={shown}>
      <Icon icon={STATE_ICON[shown]} pixels={iconPixels("base")} />
      <span>{t(DESKTOP_STATE_KEY[shown])}</span>
    </span>
  );
}
