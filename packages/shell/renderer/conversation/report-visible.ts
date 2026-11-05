// 대화가 사람 눈에 보이는 동안 main에 알린다. 알림과 finished 점이 "사람이 보고 있다"를 이것으로 판단하므로
// 대화를 그리는 곳(workspace 창(Home, project)의 Agent 탭, 앱 side panel)은 모두 이것을 불러야 한다.
import { useEffect } from "react";

import type { LophnNoticeApi } from "../../ipc/notice.ts";

/** `shown`은 mount돼 있어도 CSS로 숨긴 칸(side panel의 다른 탭)을 가르려고 받는다. */
export function useReportVisible(session: string | null, shown = true): void {
  useEffect(() => {
    const notice = (globalThis as { lophnNotice?: LophnNoticeApi }).lophnNotice;
    if (notice === undefined || session === null || !shown) return;
    void notice.visible({ session, visible: true });
    return () => void notice.visible({ session, visible: false });
  }, [session, shown]);
}
