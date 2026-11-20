// core가 알리는 자동 전역 hook 설치 결과(`HookInstallFinished`)를 이 창 위 overlay로 보인다.
// terminal이 실린 결과는 그 터미널 탭이 있는 창만 보이고, 성공이면 toast, 실패면 닫기만 있는 dialog다.
import { useEffect } from "react";
import { t } from "@lophn/i18n";

import type { HookResult } from "../../../../protocol/coding-agent/coding-agents.ts";
import type { OverlayApi } from "../../../ipc/overlay.ts";
import {
  centerAnchor,
  overlayConsumer,
  toastAnchor,
} from "../../overlay/consumer.ts";
import type { TerminalStore } from "../../terminal/store.ts";
import { useOptionalEventClient } from "../connection/events/hooks.tsx";

function failureText(result: HookResult): string {
  const detail = [result.message, ...result.files]
    .filter((line) => line !== undefined && line !== "")
    .join("\n");
  return detail === ""
    ? t("common.notice.coding-agent-register-failed")
    : `${t("common.notice.coding-agent-register-failed")}\n\n${detail}`;
}

export function HookPromptHost({
  overlay,
  terminals,
}: {
  overlay: OverlayApi;
  terminals: Pick<TerminalStore, "has">;
}) {
  const events = useOptionalEventClient();
  useEffect(() => {
    if (events === null) return;
    let results = 0;

    const consumer = overlayConsumer(
      overlay,
      () => {},
      () => {},
    );

    function finished(result: HookResult) {
      if (result.terminal !== undefined && !terminals.has(result.terminal)) {
        return;
      }
      const requestId = `hook-result-${++results}`;
      if (result.ok) {
        void consumer.open(
          {
            requestId,
            kind: "notification",
            anchorRect: toastAnchor(),
            model: {
              label: t("common.title.coding-agent-registered", {
                harness: result.label,
              }),
              ...(result.running
                ? {
                    text: t("common.notice.coding-agent-restart", {
                      harness: result.label,
                    }),
                  }
                : {}),
              tone: "neutral",
              choices: [],
            },
          },
          document.body,
        );
        return;
      }
      void consumer.open(
        {
          requestId,
          kind: "dialog",
          anchorRect: centerAnchor(),
          model: {
            label: t("common.title.coding-agent-register-failed", {
              harness: result.label,
            }),
            text: failureText(result),
            choices: [{ id: "close", label: t("common.button.close") }],
          },
        },
        document.body,
      );
    }

    const off = events.subscribe(
      { types: ["HookInstallFinished"] },
      (message) => {
        if (message.kind !== "event") return;
        if (message.event.type === "HookInstallFinished") {
          finished(message.event.payload);
        }
      },
    );

    return () => {
      off();
      consumer.dispose();
    };
  }, [overlay, terminals, events]);

  return null;
}
