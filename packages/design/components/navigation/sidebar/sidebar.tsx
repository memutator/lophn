import type { LucideIcon } from "lucide-react";
import { Icon } from "../../primitives/icon/icon.tsx";
import { componentMark, iconPixels } from "../../_shared/shared.ts";
import { useContainerSpace } from "../../layout/app-shell/app-shell.tsx";
import styles from "./sidebar.module.css";

export interface SidebarItem {
  id: string;
  label: string;
  icon?: LucideIcon;
}

export interface SidebarProps {
  items: readonly SidebarItem[];
  current?: string;
  onSelect: (id: string) => void;
}

// 앱 화면 사이의 이동. 전체에서는 왼쪽 세로 목록, 패널·카드에서는 가로로 scroll하는 한 줄이다.
export function Sidebar({ items, current, onSelect }: SidebarProps) {
  const space = useContainerSpace();
  return (
    <ul
      className={styles.sidebar}
      data-space={space}
      {...componentMark("Sidebar")}
    >
      {items.map((item) => (
        <li key={item.id} className={styles.entry}>
          <button
            type="button"
            className={styles.item}
            data-current={item.id === current || undefined}
            aria-current={item.id === current ? "page" : undefined}
            onClick={() => onSelect(item.id)}
          >
            {item.icon && <Icon icon={item.icon} pixels={iconPixels("base")} />}
            <span className={styles.label}>{item.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
