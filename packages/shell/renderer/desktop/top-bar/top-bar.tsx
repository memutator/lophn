import type { ReactNode } from "react";

import { bridge, WindowButtons } from "../../shell/window-buttons.tsx";
import { currentPlatform, type WindowPlatform } from "./platform.ts";
import styles from "./top-bar.module.css";

interface TopBarProps {
  /** 바 왼쪽 자리. */
  leading?: ReactNode;
  /** 바 오른쪽 자리. */
  trailing?: ReactNode;
  /** 비울 OS 창 조작 자리. 기본은 지금 renderer의 OS다. */
  platform?: WindowPlatform;
}

// 36px 끌기 바(떼어 낸 창·앱 창). macOS 신호등 80px을 비우고 Windows·Linux는 오른쪽 끝에 창 단추 셋을
// 그린다(shell의 title bar와 같은 WindowButtons). 조작 요소만 끌기에서 뺀다.
export function TopBar({
  leading,
  trailing,
  platform = currentPlatform(),
}: TopBarProps) {
  return (
    <header className={styles.bar} data-platform={platform}>
      <div className={styles.leading}>{leading}</div>
      <div className={styles.trailing}>{trailing}</div>
      {platform === "mac" ? null : (
        <span className={styles.controls}>
          <WindowButtons api={bridge()} />
        </span>
      )}
    </header>
  );
}
