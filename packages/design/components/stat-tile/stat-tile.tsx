import type { ReactNode } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { formatNumber } from "@lophn/wording";
import { Icon } from "../icon.tsx";
import { iconPixels } from "../shared.ts";
import styles from "./stat-tile.module.css";

export type StatDirection = "up" | "down" | "flat";

export function statDirection(change: number): StatDirection {
  return change > 0 ? "up" : change < 0 ? "down" : "flat";
}

const DIRECTION_ICONS = { up: TrendingUp, down: TrendingDown, flat: Minus };

export interface StatTileProps {
  // 사람이 읽는 라벨과 단위는 호출자가 준다.
  label: string;
  value: number;
  unit?: string;
  // 같은 단위의 변화량. 부호와 방향 아이콘을 함께 쓴다.
  change?: number;
  // 변화의 비교 기준(예: 지난주 대비). 사람이 읽는 글이다.
  changeLabel?: string;
  locale?: string;
}

// 라벨→4px→28px 값→4px→변화량과 방향 아이콘. 값은 계열색이 아닌 중립 글자색이다.
export function StatTile(
  { label, value, unit, change, changeLabel, locale = "en" }: StatTileProps,
) {
  const direction = change === undefined ? undefined : statDirection(change);
  return (
    <div className={styles.tile}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>
        <span className={styles.number}>{formatNumber(value, locale)}</span>
        {unit !== undefined && <span className={styles.unit}>{unit}</span>}
      </span>
      {change !== undefined && direction !== undefined && (
        <span className={styles.change} data-direction={direction}>
          <Icon
            icon={DIRECTION_ICONS[direction]}
            pixels={iconPixels("small")}
          />
          <span>{formatNumber(change, locale, { sign: true })}</span>
          {changeLabel !== undefined && <span>{changeLabel}</span>}
        </span>
      )}
    </div>
  );
}

// 한 줄에 최대 4개. 더 많으면 다음 줄로 넘긴다. 넣은 칸이 640px 미만이면 한 줄에 2개다.
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className={styles.rowBox}>
      <div className={styles.row}>{children}</div>
    </div>
  );
}
