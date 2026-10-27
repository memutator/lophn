// 저장이 끝나지 않은 문서를 두고 탭·창을 닫을 때의 질문. shell overlay의
// dialog로 연다. 되돌릴 수 없는 결정이 아니라 초안을 지킬지 묻는다.
// 창 닫힘·Escape·overlay 실패는 결정이 아니라 계속 편집이다.
import { t } from "@lophn/wording";

import type { OverlayApi } from "../../ipc/overlay.ts";
import { centerAnchor, overlayConsumer } from "../overlay/consumer.ts";
import type { LeaveAsker, LeaveChoice } from "./sessions.ts";

const KEEP = "keep-editing";
const CHECK = "check-again";
const DISCARD = "discard-changes";

let requests = 0;

export function overlayLeaveAsker(api: OverlayApi): LeaveAsker {
  const waiting = new Map<string, (choice: LeaveChoice) => void>();
  const consumer = overlayConsumer(
    api,
    (result) => {
      if (result.type === "pointer" || result.type === "query") return;
      const resolve = waiting.get(result.requestId);
      if (!resolve) return;
      waiting.delete(result.requestId);
      const chosen = result.type === "selected" ? result.choiceId : null;
      resolve(
        chosen === DISCARD ? "discard" : chosen === CHECK ? "check" : "keep",
      );
    },
    () => {
      for (const resolve of waiting.values()) resolve("keep");
      waiting.clear();
    },
  );
  return {
    async ask(name) {
      const requestId = `editor-leave-${++requests}`;
      const opener =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : document.body;
      const answer = new Promise<LeaveChoice>((resolve) => {
        waiting.set(requestId, resolve);
      });
      const opened = await consumer.open(
        {
          requestId,
          kind: "dialog",
          anchorRect: centerAnchor(),
          model: {
            label: t("document.title.unsaved"),
            text:
              name === null
                ? t("document.dialog.unsaved-many")
                : t("document.dialog.unsaved-one", { name }),
            choices: [
              { id: KEEP, label: t("document.button.keep-editing") },
              { id: CHECK, label: t("document.button.check-again") },
              { id: DISCARD, label: t("document.button.discard-changes") },
            ],
          },
        },
        opener,
      );
      if (!opened.ok) {
        waiting.delete(requestId);
        return "keep";
      }
      return await answer;
    },
  };
}
