// core가 묻는 전역 hook 설치(`HookInstallAsked`)를 이 창 위 overlay의 dialog로 보이고 `coding_agents/hook_answer`로 답한다.
// 물음은 모든 창에 가고, 그 터미널의 탭이 있는 창만 묻는다. 결과(`HookInstallFinished`)는 이 창이 설치를 허락한 harness의
// 것만 보인다: 성공이면 toast, 실패면 닫기만 있는 dialog다. 창마다 한 번 마운트한다. 사람이 닫지 않은 채 창이 reload되면
// 답이 가지 않고, shell 연결이 닫히면 core가 거절로 센다.
import { useEffect } from "react";
import { t } from "@lophn/i18n";

import {
  codingAgentsHookAnswer,
  type HookAsk,
  type HookResult,
} from "../../../../protocol/coding-agent/coding-agents.ts";
import type { OverlayApi } from "../../../ipc/overlay.ts";
import {
  centerAnchor,
  overlayConsumer,
  toastAnchor,
} from "../../overlay/consumer.ts";
import type { TerminalStore } from "../../terminal/store.ts";
import { useOptionalEventClient } from "../connection/events/hooks.tsx";

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
  terminals,
}: {
  overlay: OverlayApi;
  terminals: Pick<TerminalStore, "has">;
}) {
  const events = useOptionalEventClient();
  useEffect(() => {
    if (events === null) return;
    // request마다 답을 기다리는 중인 ask. 닫힘·overlay 실패는 거절이다.
    const waiting = new Map<string, HookAsk>();
    // 이 창에서 설치를 허락한 harness. 그 결과만 이 창이 보인다.
    const accepted = new Set<string>();
    let results = 0;

    function answer(ask: HookAsk, yes: boolean) {
      if (yes) accepted.add(ask.harness);
      void events!.core.call({
        kind: codingAgentsHookAnswer.kind,
        resource: codingAgentsHookAnswer.resource,
        method: codingAgentsHookAnswer.method,
        body: { request: ask.request, accepted: yes },
      });
    }

    const consumer = overlayConsumer(
      overlay,
      (result) => {
        if (result.type === "pointer" || result.type === "query") return;
        const ask = waiting.get(result.requestId);
        if (ask === undefined) return;
        waiting.delete(result.requestId);
        answer(ask, result.type === "selected" && result.choiceId === INSTALL);
      },
      () => {
        for (const ask of waiting.values()) answer(ask, false);
        waiting.clear();
      },
    );

    function asked(ask: HookAsk) {
      if (!terminals.has(ask.terminal)) return;
      const requestId = `hook-ask-${ask.request}`.slice(0, 80);
      waiting.set(requestId, ask);
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
          answer(ask, false);
        });
    }

    function finished(result: HookResult) {
      if (!accepted.delete(result.harness)) return;
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
    }

    const off = events.subscribe(
      { types: ["HookInstallAsked", "HookInstallFinished"] },
      (message) => {
        if (message.kind !== "event") return;
        const event = message.event;
        if (event.type === "HookInstallAsked") asked(event.payload);
        else if (event.type === "HookInstallFinished") finished(event.payload);
      },
    );

    return () => {
      off();
      // 창이 사라지면 dialog도 사라진다. 기다리던 ask는 거절이다.
      for (const ask of waiting.values()) answer(ask, false);
      waiting.clear();
      consumer.dispose();
    };
  }, [overlay, terminals, events]);

  return null;
}
