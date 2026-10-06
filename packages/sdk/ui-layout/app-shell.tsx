import { createContext, type ReactNode, useContext, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Icon, iconPixels, useObservedSize } from "@lophn/design/components";
import { type ContainerSpace, containerSpace } from "./space.ts";
import styles from "./layout.module.css";

const SpaceContext = createContext<ContainerSpace>("full");

// AppShell 안의 화면이 지금 놓인 container 크기 종류를 읽는다.
export function useContainerSpace(): ContainerSpace {
  return useContext(SpaceContext);
}

export interface AppShellProps {
  // 앱이 정한 화면 이름. 앱의 message key 문구다.
  title: string;
  // 머리 오른쪽 끝의 행동. 주 행동은 하나다.
  actions?: ReactNode;
  // 보통 Sidebar 하나.
  nav?: ReactNode;
  children: ReactNode;
}

// 앱 view 안의 화면 틀. 바깥 크롬은 lophn이 그리고 앱은 자기 머리부터 그린다.
// 넣은 영역의 폭을 관측해 패널·카드에서는 sidebar를 본문 위 한 줄로 옮긴다(apps/sdk#R37).
export function AppShell({ title, actions, nav, children }: AppShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useObservedSize(ref);
  const space = size === undefined ? "full" : containerSpace(size.width);
  return (
    <SpaceContext.Provider value={space}>
      <div ref={ref} className={styles.shell} data-space={space}>
        <header className={styles.bar}>
          <h1 className={styles.title}>{title}</h1>
          {actions !== undefined && (
            <div className={styles.actions}>{actions}</div>
          )}
        </header>
        <div className={styles.body}>
          {nav !== undefined && <nav className={styles.nav}>{nav}</nav>}
          <main className={styles.main}>{children}</main>
        </div>
      </div>
    </SpaceContext.Provider>
  );
}

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
  return (
    <ul className={styles.sidebar}>
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

export interface GridProps {
  children: ReactNode;
}

// 카드 폭 240px 이상의 칸을 container 폭에 맞게 채운다. 좁으면 한 줄 한 칸이다.
export function Grid({ children }: GridProps) {
  return <div className={styles.grid}>{children}</div>;
}
