// lophn-agent slice flow E2E: answer-question(docs/flows/answer-question.md). 실제 shell(headless)·
// core(제품 runtime child를 띄우는 기동)를 임시 LOPHN_HOME으로 띄우고, model이 끼는 단계는
// tools/fake-provider(loopback fixture server)로 검증하며 실제 ~/.lophn은 열지 않는다.
// - 2: 사람은 대화 도크의 질문 칸에서 질문 글·이유·설명 있는 선택지·추천 이유를 읽고, 고르기만
//   해서는 답이 확정되지 않음을 본다(고른 뒤에도 질문은 답이 없다).
// - 3·5: 선택 클릭만으로는 답이 아니다. 답을 확정하는 길은 아래 통로 없음 때문에 이 흐름에서
//   볼 수 없다.
// - 6의 사람 쪽: 답을 정하지 못하면 미루기, 필요 없으면 이유와 함께 취소한다. 둘 다 답 없음으로
//   남고, 같은 run에 답을 기다리는 질문은 하나뿐이라 질문마다 자기 요청(run)을 쓴다.
// 통로가 없어 볼 수 없는 것: 답을 기다리는 run(questions#R7)은 제품 runtime이 질문을 만들 때
// run을 멈추지 않으므로(WaitRun의 대기는 approval만 받는다) 이 흐름에서 볼 수 없다. 그래서
// 질문을 만든 run은 곧바로 끝나고 답(questions/answer)은 "the run is finished"로 거절된다.
// 답 접수와 실제 적용 결과를 나란히 보는 자리는 things-to-confirm 화면(shell#T29)이다.
import { assert, assertEquals } from "@std/assert";

import { startFakeProvider } from "../../tools/fake-provider/mod.ts";
import { e2eEnabled } from "../harness.ts";
import {
  commandBody,
  delay,
  mustCall,
  openFlowShell,
  removeHome,
} from "../flow-support.ts";

const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const MODEL = "claude-sonnet-4-5";

const INPUT = "[data-composer-input]";
const SEND = "[data-send]";
const STRIP = "[data-question-strip]";
const READY = "[data-question-text='ready']";

const FIRST = "Which wording?";
const SECOND = "Change it later?";
const THIRD = "Rewrite it now?";

/** 질문 하나를 만드는 model 판단. 선택지 둘과 (첫 질문에만) 추천 하나를 싣는다. */
function ask(prompt: string, recommended: boolean) {
  return {
    protocol: "messages" as const,
    reply: {
      text: "One decision is yours.",
      toolCalls: [{
        id: `toolu_${prompt.length}`,
        name: "question.submit",
        arguments: JSON.stringify({
          prompt,
          reason: "the glossary has two possible meanings",
          options: [
            {
              key: "keep",
              label: "Keep the current wording",
              description: "Leave the glossary as it is.",
              evidence: [],
              adoption: null,
              action: null,
            },
            {
              key: "change",
              label: "Change the wording",
              description: "Rewrite the glossary entry.",
              evidence: [],
              adoption: null,
              action: null,
            },
          ],
          recommendation: recommended
            ? {
              option_key: "keep",
              explanation: "Nothing else reads it yet.",
            }
            : null,
          expires_at: null,
        }),
      }],
      usage: { input: 20, output: 8 },
      stop: "tool_calls" as const,
    },
  };
}

const END = {
  protocol: "messages" as const,
  reply: {
    text: "Tell me when you decide.",
    usage: { input: 40, output: 9 },
    stop: "end" as const,
  },
};

// 요청 하나(run 하나)마다 질문 하나. 같은 run에 답을 기다리는 질문은 하나만 두므로 질문 셋은
// 사람이 보낸 요청 셋에서 나온다.
const SCRIPT = {
  steps: [
    { id: "ask-first", ...ask(FIRST, true) },
    { id: "end-first", ...END },
    { id: "ask-second", ...ask(SECOND, false) },
    { id: "end-second", ...END },
    { id: "ask-third", ...ask(THIRD, false) },
    { id: "end-third", ...END },
  ],
};

Deno.test({
  name:
    "lophn-agent/questions#R3 lophn-agent/questions#R4 lophn-agent/questions#R6 flow answer-question: 질문 글·선택지·추천을 읽고 고르기만으로는 답하지 않으며 미루기·취소는 답 없음으로 남는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const provider = startFakeProvider({
      script: SCRIPT,
      nowMs: () => Date.now(),
      instant: true,
    });
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await mustCall(flow, {
        kind: "command",
        resource: "providers",
        method: "register",
        body: commandBody({
          id: PROVIDER,
          name: "fixture",
          definition: {
            key: "anthropic",
            display_name: "Anthropic",
            protocols: ["anthropic-messages"],
            auth_kinds: ["none"],
            models_endpoint: null,
            oauth: null,
            revision: "2026-01-01",
          },
          endpoint: provider.url,
          protocol: "anthropic-messages",
        }),
      });
      const defaults = await mustCall(flow, {
        kind: "read",
        resource: "agent-model-defaults",
        method: "read",
        body: {},
      });
      const seq = (defaults.defaults as { settings_seq: string }).settings_seq;
      await mustCall(flow, {
        kind: "command",
        resource: "agent-model-defaults",
        method: "change",
        body: commandBody(
          {
            judgment: {
              provider: PROVIDER,
              credentials: [],
              model_name: MODEL,
              reasoning_level: "provider_default",
              options: {},
            },
            organizing: null,
            settings_seq: seq,
          },
          { settings_seq: seq },
        ),
      });

      /** 질문 기록(사람 token의 questions/list 읽기). 접수 순서다. */
      const questions = async (status?: string) => {
        const listed = await mustCall(flow, {
          kind: "read",
          resource: "questions",
          method: "list",
          body: status === undefined ? {} : { status },
        });
        return listed.questions as {
          id: string;
          status: string;
          answer: { kind: string; option?: string } | null;
          closed_reason: string | null;
          closed_reason_blob: string | null;
          created_seq: string;
        }[];
      };
      /** 도크가 마지막으로 보인 글. 실패했을 때 이유를 담는다. */
      const dockText = async () =>
        String(
          await flow.evaluate(
            `document.querySelector("[data-dock]")?.innerText ?? null`,
          ),
        ).slice(0, 400);
      /** 칸의 조건이 서지 않으면 지금 사실을 담아 던진다. */
      const untilStrip = async (expression: string, what: string) => {
        try {
          await flow.until(expression, what, 120_000);
        } catch (error) {
          throw new Error(
            `${(error as Error).message} | calls=${
              JSON.stringify(
                provider.requests().map((entry) => entry.matchedStep),
              )
            } questions=${JSON.stringify(await questions())} dock=${
              JSON.stringify(await dockText())
            }`,
          );
        }
      };
      /** 질문이 `want`를 채울 때까지 기다린다. */
      const untilQuestion = async (
        id: string,
        want: (row: Awaited<ReturnType<typeof questions>>[number]) => boolean,
        what: string,
      ) => {
        const deadline = Date.now() + 120_000;
        for (;;) {
          const row = (await questions()).find((item) => item.id === id);
          if (row !== undefined && want(row)) return row;
          assert(
            Date.now() < deadline,
            `${what}: ${JSON.stringify(row ?? null)}`,
          );
          await delay(250);
        }
      };
      /** 마지막 사람 말이 접수로 확정될 때까지 기다린다. */
      const untilConfirmed = () =>
        flow.until(
          `(() => { const rows = [...document.querySelectorAll("[data-actor='user']")]; const last = rows.at(-1)?.querySelector("[data-delivery]")?.getAttribute("data-delivery"); return rows.length > 0 && last !== null && last !== undefined && last !== "sending"; })()`,
          "보낸 말이 접수로 확정되지 않았다",
        );
      /** 질문 하나를 만드는 요청을 보내고 그 질문이 칸에 설 때까지 기다린다. */
      const askWith = async (text: string, want: string) => {
        const before = (await questions()).length;
        await flow.type(INPUT, text);
        await flow.click(SEND);
        await untilConfirmed();
        const deadline = Date.now() + 120_000;
        for (;;) {
          if ((await questions()).length > before) break;
          assert(
            Date.now() < deadline,
            `질문이 만들어지지 않았다: ${
              JSON.stringify(
                provider.requests().map((entry) => entry.matchedStep),
              )
            }`,
          );
          await delay(250);
        }
        await untilStrip(
          `document.querySelector(${JSON.stringify(READY)})?.textContent === ${
            JSON.stringify(want)
          }`,
          `질문이 칸에 서지 않았다: ${want}`,
        );
      };

      // 대화 도크를 열고 새 세션 하나를 연다(사람 조작).
      await flow.until(
        `document.querySelector("[data-dock-toggle]") !== null`,
        "도크 토글이 없다",
      );
      await flow.click("[data-dock-toggle]");
      await flow.until(
        `document.querySelector("[data-dock]") !== null`,
        "대화 도크가 열리지 않았다",
      );
      await flow.until(
        `document.querySelector("[data-new-session]") !== null`,
        "새 세션 단추가 서지 않았다",
      );
      await flow.click("[data-new-session]");
      await flow.until(
        `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
        "입력칸이 서지 않았다",
      );

      await t.step(
        "lophn-agent/questions#R3 lophn-agent/questions#R4: 2 질문 글·이유·선택지 설명·추천을 읽는다",
        async () => {
          await askWith("Tidy the glossary.", FIRST);
          assertEquals(
            await flow.text("[data-question-reason]"),
            "the glossary has two possible meanings",
          );
          // 선택지 둘의 이름과 설명, 추천 이유가 보인다.
          assertEquals(
            await flow.text("[data-option='keep'] [data-option-description]"),
            "Leave the glossary as it is.",
          );
          assertEquals(
            await flow.text("[data-option='change'] [data-option-description]"),
            "Rewrite the glossary entry.",
          );
          assertEquals(await flow.count("[data-recommended]"), 1);
          assert(
            (await flow.text("[data-recommendation]"))?.includes(
              "Nothing else reads it yet.",
            ) === true,
            "추천 이유가 없다",
          );
          assertEquals(await flow.text("[data-position]"), "1 of 1");
          assertEquals((await questions("pending")).length, 1);
        },
      );

      await t.step(
        "lophn-agent/questions#R6: 3 선택 클릭만으로는 답이 확정되지 않는다",
        async () => {
          const [first] = await questions("pending");
          assert(first !== undefined, "첫 질문이 없다");
          await flow.click("[data-option='keep']");
          await untilStrip(
            `document.querySelector("[data-option='keep']")?.getAttribute("aria-checked") === "true"`,
            "선택지가 골라지지 않았다",
          );
          // 고른 것만으로는 보내지 않는다. 질문은 아직 답이 없다.
          await delay(1_000);
          const row = (await questions()).find((item) => item.id === first.id);
          assertEquals(row?.status, "pending");
          assertEquals(row?.answer, null);
        },
      );

      await t.step(
        "lophn-agent/questions#R6: 6 정하지 못한 질문은 미루기, 필요 없는 질문은 이유와 함께 취소한다",
        async () => {
          // 미루기: 칸이 가리키는 질문이 답 없이 닫힌다.
          const [first] = await questions("pending");
          assert(first !== undefined, "첫 질문이 없다");
          await flow.click("[data-later]");
          const deferred = await untilQuestion(
            first.id,
            (row) => row.status === "cancelled",
            "미루기가 접수되지 않았다",
          );
          assertEquals(deferred.closed_reason, "deferred");
          assertEquals(deferred.answer, null);
          await untilStrip(
            `document.querySelector(${JSON.stringify(STRIP)}) === null`,
            "기다리는 질문이 없는데 칸이 남아 있다",
          );

          // 두 번째 질문: 취소는 이유를 적어야 확정된다.
          await askWith("Change it later.", SECOND);
          await flow.click("[data-cancel-question]");
          await untilStrip(
            `document.querySelector("[data-cancel-form]") !== null`,
            "취소 입력이 열리지 않았다",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-confirm-cancel]")?.hasAttribute("disabled") ?? true`,
            ),
            true,
            "이유 없이 취소할 수 있다",
          );
          await flow.type("[data-cancel-reason]", "Not needed anymore");
          await flow.click("[data-confirm-cancel]");
          const [second] = await questions("pending");
          assert(second !== undefined, "두 번째 질문이 없다");
          const cancelled = await untilQuestion(
            second.id,
            (row) => row.status === "cancelled",
            "취소가 접수되지 않았다",
          );
          assertEquals(cancelled.closed_reason, "cancelled");
          assert(
            cancelled.closed_reason_blob !== null,
            "취소 이유가 남지 않았다",
          );
          assertEquals(cancelled.answer, null);

          // 세 번째 질문은 그대로 기다린다. 답을 확정하는 길은 위 통로 없음 때문이다.
          await askWith("Rewrite it now.", THIRD);
          assertEquals((await questions("pending")).length, 1);
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await provider.close();
    }
  },
});
