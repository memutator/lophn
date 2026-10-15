import type { LucideIcon } from "lucide-react";
import { Button } from "../button/button.tsx";
import { Icon } from "../icon.tsx";
import { componentMark, iconPixels } from "../shared.ts";
import styles from "../state.module.css";

export interface EmptyAction {
  label: string;
  onSelect: () => void;
}

export interface EmptyStateProps {
  // 비어 있는 대상을 가리키는 20px 아이콘. 삽화는 두지 않는다.
  icon: LucideIcon;
  // 한 문장.
  message: string;
  // 다음 행동은 언제나 하나다.
  action: EmptyAction;
}

export function EmptyState({ icon, message, action }: EmptyStateProps) {
  return (
    <div
      className={styles.state}
      data-state="empty"
      {...componentMark("EmptyState")}
    >
      <Icon icon={icon} pixels={iconPixels("large")} className={styles.icon} />
      <p className={styles.message}>{message}</p>
      <Button onClick={action.onSelect}>{action.label}</Button>
    </div>
  );
}
