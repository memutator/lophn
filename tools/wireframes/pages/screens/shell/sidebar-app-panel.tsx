// project 창 오른쪽 sidebar에 앱 sidebar 화면이 panel로 나온 상태. 진짜 Desktop(MockDesktop)을 그리고 설치된 앱의
// `sidebar` 화면을 가짜로 준다(사람이 `shell.sidebar_panels_off`로 끄지 않으면 나온다). 앱 화면은 <webview>라 gallery에서 돌 수 없으므로 webview 그릇이 그린 빈 자리에
// Orders 앱의 고정 그림(orders-view.tsx)을 넣는다.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { APP_BUDGET } from "../../../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import { openProject } from "../../../../../packages/shell/renderer/desktop/router.ts";
import { OrdersView } from "../../../mock/app-space/orders-view.tsx";
import { press, useDrive } from "../../../mock/drive.ts";
import { useMockTabHead } from "../../../mock/tab-head.ts";
import { MockDesktop, PROJECT_GROCERY } from "../../../mock/mock-desktop.tsx";

const LABEL = "Orders";
// Orders 앱이 useTabHead로 올린 머리 줄. panel 머리의 단추 자리에 상태 글과 단추 하나로 선다.
const HEAD = {
  status: "3 open",
  actions: [{ id: "new-order", label: "New order" }],
};
const NOTES = {
  key: "/home/mina/Documents/grocery/notes.md",
  kind: "document_editor",
  title: "notes.md",
} as const;

function useSidebarRegion(): HTMLElement | null {
  const [region, setRegion] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const look = () =>
      setRegion(
        document.querySelector<HTMLElement>(
          '[data-webview-kind="app"][data-webview-key^="sidebar:"]',
        ),
      );
    look();
    const watch = new MutationObserver(look);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);
  return region;
}

export function SidebarAppPanel() {
  const region = useSidebarRegion();
  useMockTabHead(region, HEAD);
  useDrive(() => press('[role="tab"]', new RegExp(`^${LABEL}$`)));
  return (
    <>
      <MockDesktop
        route={openProject(PROJECT_GROCERY)}
        panes={[{ tabs: [NOTES], selected: NOTES.key }]}
        sidebarPanel={{ app: APP_BUDGET, screen: "orders", label: LABEL }}
      />
      {region === null ? null : createPortal(<OrdersView marks={{}} />, region)}
    </>
  );
}
