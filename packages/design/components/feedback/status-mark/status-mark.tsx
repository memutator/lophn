import type { LucideIcon } from "lucide-react";
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import type { StatusTone } from "../../../tokens.ts";
import { Icon } from "../../primitives/icon/icon.tsx";
import { componentMark, iconPixels } from "../../_shared/shared.ts";
import styles from "./status-mark.module.css";

// tokens.status의 아이콘 이름과 같은 Lucide 아이콘.
export const STATUS_ICONS: Record<StatusTone, LucideIcon> = {
  good: CircleCheck,
  warning: TriangleAlert,
  serious: OctagonAlert,
  critical: CircleX,
  neutral: CircleDashed,
};

export interface StatusMarkProps {
  tone: StatusTone;
  // 상태 이름. 색 없이도 이 글과 아이콘 모양으로 구별한다.
  label: string;
}

export function StatusMark({ tone, label }: StatusMarkProps) {
  return (
    <span
      className={styles.mark}
      data-tone={tone}
      {...componentMark("StatusMark")}
    >
      <Icon
        icon={STATUS_ICONS[tone]}
        pixels={iconPixels("base")}
        className={styles[tone]}
      />
      <span className={styles.label}>{label}</span>
    </span>
  );
}
