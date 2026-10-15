import type { LucideIcon } from "lucide-react";
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import type { StatusTone } from "../../tokens.ts";
import { Icon } from "../icon.tsx";
import { componentMark, iconPixels } from "../shared.ts";
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

export type DiffKind = "add" | "delete";

const DIFF_SIGNS: Record<DiffKind, string> = { add: "+", delete: "−" };

// diff 줄의 +/− 기호. 줄 배경색과 함께 쓰며 색 없이도 추가·삭제를 읽는다.
export function DiffMark({ kind }: { kind: DiffKind }) {
  return (
    <span
      className={styles.sign}
      data-diff={kind}
      {...componentMark("DiffMark")}
    >
      {DIFF_SIGNS[kind]}
    </span>
  );
}
