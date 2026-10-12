import type { ReactNode } from "react";
import {
  Icon,
  IconButton,
  iconPixels,
  type IconProps,
} from "@lophn/design/components";
import { workspaceIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "./notice-card.module.css";

export interface NoticeCardProps {
  icon?: IconProps["icon"];
  /** 안내 글. 비면 글 줄을 그리지 않는다. */
  text: ReactNode;
  textData?: Record<string, string>;
  tone?: "neutral" | "error";
  /** 카드 아래 행동 단추들. */
  actions?: ReactNode;
  /** 있으면 닫기 단추를 둔다. */
  onDismiss?: () => void;
  data?: Record<string, string>;
}

// 프로젝트 작업대의 떠 있는 안내 카드. toast와 같은 폭·표면이지만 저절로 사라지지 않고,
// 본문 자리를 차지하지 않는다. 닫아도 상단 바의 안내 단추로 다시 연다.
export function NoticeCard(
  {
    icon,
    text,
    textData,
    tone = "neutral",
    actions,
    onDismiss,
    data,
  }: NoticeCardProps,
) {
  return (
    <div className={styles.card} data-tone={tone} {...data}>
      <div className={styles.head}>
        {icon
          ? (
            <Icon
              icon={icon}
              pixels={iconPixels("base")}
              className={styles.icon}
            />
          )
          : null}
        <p className={styles.text} {...textData}>{text}</p>
        {onDismiss
          ? (
            <IconButton
              icon={workspaceIcons.close}
              label={t("common.button.close")}
              size="sm"
              data-dismiss-notice=""
              onClick={onDismiss}
            />
          )
          : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
