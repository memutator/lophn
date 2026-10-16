import type { ReactNode } from "react";
import { Command } from "lucide-react";
import { t } from "@lophn/wording";
import { IconButton, Tooltip } from "@lophn/design/components";
import { lophnEntryIcon } from "../../icons/mod.ts";

import { currentPlatform, type WindowPlatform } from "./platform.ts";
import styles from "./top-bar.module.css";
import { WindowControls } from "./window-controls.tsx";

interface TopBarProps {
  /** 바 왼쪽 자리. 런처는 wordmark를 둔다. */
  leading?: ReactNode;
  /** 바 오른쪽 자리. 런처는 lophn 관리 진입점을 둔다. */
  trailing?: ReactNode;
  /** 비울 OS 창 조작 자리. 기본은 지금 renderer의 OS다. */
  platform?: WindowPlatform;
}

// 36px 끌기 바. macOS 신호등 80px을 비우고 Windows·Linux는 오른쪽 끝에 창 단추 셋(46px 셋, 138px)을
// 직접 그린다. 조작 요소만 끌기에서 뺀다.
export function TopBar(
  { leading, trailing, platform = currentPlatform() }: TopBarProps,
) {
  return (
    <header className={styles.bar} data-platform={platform}>
      <div className={styles.leading}>{leading}</div>
      <div className={styles.trailing}>{trailing}</div>
      {platform === "mac" ? null : <WindowControls />}
    </header>
  );
}

/** 바 왼쪽의 제품 이름. */
export function Wordmark({ children }: { children: ReactNode }) {
  return <span className={styles.wordmark}>{children}</span>;
}

// 바 오른쪽의 고정 진입점. 형제 카드가 아니라 아이콘 하나이고 이름은 tooltip과 aria-label이다.
export function LophnEntry({ onLophn }: { onLophn: () => void }) {
  const label = t("launcher.button.lophn");
  return (
    <Tooltip content={label}>
      <IconButton
        icon={lophnEntryIcon}
        label={label}
        variant="secondary"
        size="md"
        data-entry="lophn"
        onClick={onLophn}
      />
    </Tooltip>
  );
}

// 명령 palette 단추. 검색 돋보기는 여러 화면의 검색이 쓰므로 명령 아이콘을 쓴다.
export function PaletteButton({ onClick }: { onClick?: () => void }) {
  return (
    <IconButton
      icon={Command}
      label={t("common.button.palette-open")}
      variant="ghost"
      onClick={onClick}
    />
  );
}
