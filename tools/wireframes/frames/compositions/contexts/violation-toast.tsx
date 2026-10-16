// ContextViolationFound가 띄우는 overlay toast. 창 위(ProjectApp의 children)에 얹는다. 문구는 앱이 쓰는
// waiting.toast-violation key다.
import { useState } from "react";
import { Toast, ToastStack } from "@lophn/design/components";
import { t } from "@lophn/wording";

import c from "./contexts.module.css";
import { useHost } from "./open-tab.ts";
import { pmNewTab, pmWorkingTab } from "./pm-session.tsx";

// toast가 화면에 남은 채로 보이도록 시간이 가지 않는 timer를 준다.
const NO_TIMER = { set: () => 0, clear: () => {} };

/**
 * 위반이 새로 생겼다는 toast. [Ask Project Manager]는 reaction이 이미 연 session이 있으면 그 session으로,
 * 꺼져 있으면 위반을 붙여 새 session을 연다. 눌러야 Project Manager session이 열린다.
 */
export function ViolationToast(
  { reactionOpened = false }: { reactionOpened?: boolean },
) {
  const { open, opened } = useHost();
  const [closed, setClosed] = useState(false);
  if (closed || opened > 0) return null;
  return (
    <div className={c.toastRight}>
      <ToastStack>
        <Toast
          title={t("waiting.toast-violation.title")}
          body={t("waiting.toast-violation.body", { context: "eval" })}
          actions={[
            { id: "ask", label: t("waiting.toast-violation.button") },
          ]}
          onAction={() =>
            open(reactionOpened ? pmWorkingTab() : pmNewTab(), true)}
          onClose={() => setClosed(true)}
          timer={NO_TIMER}
        />
      </ToastStack>
    </div>
  );
}
