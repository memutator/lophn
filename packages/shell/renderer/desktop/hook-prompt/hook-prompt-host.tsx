// main이 묻는 전역 hook 설치를 이 창 위 overlay의 dialog로 보이고 답을 main에 돌려준다. 결과는 성공이면 toast,
// 실패면 닫기만 있는 dialog다. 창마다 한 번 마운트한다. 사람이 닫지 않은 채 창이 reload되면 main이 거절로 센다.
import { useEffect } from "react";
import { t } from "@lophn/wording";

import type { CodingApi, HookAsk, HookResult } from "../../../ipc/coding.ts";
import type { OverlayApi } from "../../../ipc/overlay.ts";
import {
  centerAnchor,
  overlayConsumer,
  toastAnchor,
} from "../../overlay/consumer.ts";

export type HookPromptApi = Pick<
  CodingApi,
  "answerHookAsk" | "onHookAsk" | "onHookResult"
>;

const INSTALL = "install";
const NOT_NOW = "not-now";

/** dialog 글. 문장과 file 목록은 빈 줄로 나눈다. */
export function askText(ask: HookAsk): string {
  return [
    t("common.notice.register-coding-agent", { harness: ask.label }),
    ...(ask.harness === "codex"
      ? [t("common.notice.register-coding-agent-codex")]
      : []),
    `${t("common.notice.register-coding-agent-files")}\n${ask.files.join(
      "\n",
    )}`,
  ].join("\n\n");
}

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
  coding,
}: {
  overlay: OverlayApi;
  coding: HookPromptApi;
}) {
  useEffect(() => {
    // request마다 답을 기다리는 중인 ask. 닫힘·overlay 실패는 거절이다.
    const waiting = new Map<string, string>();
    let results = 0;

    function answer(request: string, accepted: boolean) {
      void coding.answerHookAsk({ request, accepted });
    }

    const consumer = overlayConsumer(
      overlay,
      (result) => {
        if (result.type === "pointer" || result.type === "query") return;
        const request = waiting.get(result.requestId);
        if (request === undefined) return;
        waiting.delete(result.requestId);
        answer(
          request,
          result.type === "selected" && result.choiceId === INSTALL,
        );
      },
      () => {
        for (const request of waiting.values()) answer(request, false);
        waiting.clear();
      },
    );

    const offAsk = coding.onHookAsk((ask) => {
      const requestId = `hook-ask-${ask.request}`.slice(0, 80);
      waiting.set(requestId, ask.request);
      const opener =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : document.body;
      void consumer
        .open(
          {
            requestId,
            kind: "dialog",
            anchorRect: centerAnchor(),
            model: {
              label: t("common.title.register-coding-agent", {
                harness: ask.label,
              }),
              text: askText(ask),
              choices: [
                { id: NOT_NOW, label: t("common.button.not-now") },
                { id: INSTALL, label: t("common.button.install") },
              ],
            },
          },
          opener,
        )
        .then((opened) => {
          if (opened.ok || !waiting.delete(requestId)) return;
          answer(ask.request, false);
        });
    });

    const offResult = coding.onHookResult((result) => {
      const requestId = `hook-result-${++results}`;
      // 결과는 답이 없어 열기에 실패해도 더 할 것이 없다.
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
    });

    return () => {
      offAsk();
      offResult();
      // 창이 사라지면 dialog도 사라진다. 기다리던 ask는 거절이다.
      for (const request of waiting.values()) answer(request, false);
      waiting.clear();
      consumer.dispose();
    };
  }, [overlay, coding]);

  return null;
}
