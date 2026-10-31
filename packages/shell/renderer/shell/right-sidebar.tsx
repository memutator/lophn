// 오른쪽 sidebar의 panel 틀. 머리 줄(panel 이름, 오른쪽에 그 panel의 단추)과 scroll하는 본문이다.
// 단추는 panel 본문이 `PanelActions`로 머리 줄에 올려 보낸다: 단추가 쓰는 state는 본문이 갖고 있기 때문이다.
import { createContext, type ReactNode, useContext, useState } from "react";
import { createPortal } from "react-dom";

import styles from "./right-sidebar.module.css";

const ActionsSlot = createContext<HTMLElement | null>(null);
const TitleSlot = createContext<HTMLElement | null>(null);

export interface RightSidebarProps {
  /** 머리 줄의 panel 이름. null이면 본문이 `PanelTitle`로 채운다(Files의 루트 폴더 선택). */
  title: string | null;
  /** 어느 panel인지 가르는 표식(`data-sidebar-tab`). */
  panel?: string;
  children: ReactNode;
}

export function RightSidebar({ title, panel, children }: RightSidebarProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);
  return (
    <ActionsSlot.Provider value={slot}>
      <TitleSlot.Provider value={titleSlot}>
        <div className={styles.panel}>
          <div className={styles.head}>
            <h2 ref={setTitleSlot} className={styles.title}>
              {title}
            </h2>
            <span ref={setSlot} className={styles.actions} />
          </div>
          <div className={styles.body} data-sidebar-tab={panel}>
            {children}
          </div>
        </div>
      </TitleSlot.Provider>
    </ActionsSlot.Provider>
  );
}

/** 머리 줄 오른쪽에 단추를 놓는다. `RightSidebar` 안에서만 그린다. */
export function PanelActions({ children }: { children: ReactNode }) {
  const slot = useContext(ActionsSlot);
  return slot === null ? null : createPortal(children, slot);
}

/** 머리 줄 이름 자리에 넣는다. `title`이 null인 `RightSidebar` 안에서만 그린다. */
export function PanelTitle({ children }: { children: ReactNode }) {
  const slot = useContext(TitleSlot);
  return slot === null ? null : createPortal(children, slot);
}
