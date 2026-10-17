import { createContext, type ReactNode, useContext, useRef } from "react";
import { componentMark } from "../../_shared/shared.ts";
import { useObservedSize } from "../../_shared/resize.ts";
import { type ContainerSpace, containerSpace } from "./space.ts";
import styles from "./app-shell.module.css";

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
// 넣은 영역의 폭을 관측해 패널·카드에서는 sidebar를 본문 위 한 줄로 옮긴다.
export function AppShell({ title, actions, nav, children }: AppShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useObservedSize(ref);
  const space = size === undefined ? "full" : containerSpace(size.width);
  return (
    <SpaceContext.Provider value={space}>
      <div
        ref={ref}
        className={styles.shell}
        data-space={space}
        {...componentMark("AppShell")}
      >
        <header className={styles.bar}>
          <h1 className={styles.title}>{title}</h1>
          {actions !== undefined && (
            <div className={styles.actions}>{actions}</div>
          )}
        </header>
        <div
          className={styles.body}
          data-nav={nav === undefined ? "none" : undefined}
        >
          {nav !== undefined && <nav className={styles.nav}>{nav}</nav>}
          <main className={styles.main}>{children}</main>
        </div>
      </div>
    </SpaceContext.Provider>
  );
}
