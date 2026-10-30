// 탭의 상태 점. 탭 줄, 띄운 패널, 접힌 chip, 떼어 낸 창이 같은 점을 그린다.
import { t } from "@lophn/i18n";
import styles from "./tab-state-dot.module.css";

export type TabDot = "waiting" | "working" | "ended" | "finished";

// finished는 터미널 안 agent의 turn이 끝났는데 아직 안 본 탭이라 "Session ended"와 뜻이 다르다.
export const dotLabel = (dot: TabDot) =>
  dot === "finished"
    ? t("project-workspace.label.tab-finished")
    : t(`common.label.tab-${dot}`);

export function TabStateDot({
  dot,
  className,
}: {
  dot: TabDot;
  className?: string;
}) {
  return (
    <span
      className={
        className === undefined ? styles.dot : `${styles.dot} ${className}`
      }
      data-state={dot}
      role="img"
      aria-label={dotLabel(dot)}
    />
  );
}
