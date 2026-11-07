// project 창 작업 표시줄의 tray. 진짜 Desktop(MockDesktop)을 그리고 설치된 앱의 `tray` 화면(사람이 `shell.tray_off`로 끄지 않으면 나온다)과 앱이 낸 값을
// 가짜로 준다. 항목 둘: 값을 낸 앱(Usage, tone good)과 아직 값이 없는 앱(Orders). 앱 화면은 <webview>라 gallery에서 돌 수 없으므로 popup의
// webview 그릇이 그린 빈 자리에 Usage 앱의 고정 그림을 넣는다.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  APP_BUDGET,
  APP_PLANNER,
} from "../../../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import { openProject } from "../../../../../packages/shell/renderer/desktop/router.ts";
import { UsageView } from "../../../mock/app-space/usage-view.tsx";
import { press, useDrive } from "../../../mock/drive.ts";
import { MockDesktop, PROJECT_GROCERY } from "../../../mock/mock-desktop.tsx";

const TRAY = [
  {
    app: APP_PLANNER,
    screen: "usage",
    label: "Usage",
    text: "62% left",
    tone: "good" as const,
  },
  { app: APP_BUDGET, screen: "orders", label: "Orders" },
];

function usePopupRegion(): HTMLElement | null {
  const [region, setRegion] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const look = () =>
      setRegion(
        document.querySelector<HTMLElement>(
          '[data-tray-popup] [data-webview-kind="app"]',
        ),
      );
    look();
    const watch = new MutationObserver(look);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);
  return region;
}

export function TrayScene() {
  const region = usePopupRegion();
  useDrive(() => press("[data-tray-item]", /Usage/));
  return (
    <>
      <MockDesktop route={openProject(PROJECT_GROCERY)} tray={TRAY} />
      {region === null ? null : createPortal(<UsageView />, region)}
    </>
  );
}
