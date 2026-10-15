// ContextViolationFound가 띄우는 overlay toast. 창 위(ProjectApp의 children)에 얹는다.
import { useState } from "react";
import { Toast, ToastStack } from "@lophn/design/components";

import { contextTab } from "../phroner-data.ts";
import c from "./contexts.module.css";
import { useHost } from "./open-tab.ts";
import { pmNewTab, pmWorkingTab } from "./pm-session.tsx";

// toast가 화면에 남은 채로 보이도록 시간이 가지 않는 timer를 준다.
const NO_TIMER = { set: () => 0, clear: () => {} };

/**
 * 위반이 새로 생겼다는 toast. [View]는 그 context의 Violations를 연다. [Ask Project Manager]는 reaction이 이미 연
 * session이 있으면 그 session으로, 꺼져 있으면 위반을 붙여 새 session을 연다.
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
          title="2 documents don't match"
          body="In the eval context"
          actions={[
            { id: "view", label: "View" },
            { id: "ask", label: "Ask Project Manager" },
          ]}
          onAction={(id) => {
            if (id === "view") open(contextTab("eval", "violations"));
            else open(reactionOpened ? pmWorkingTab() : pmNewTab(), true);
          }}
          onClose={() => setClosed(true)}
          timer={NO_TIMER}
        />
      </ToastStack>
    </div>
  );
}
