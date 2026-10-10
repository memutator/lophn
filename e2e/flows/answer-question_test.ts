// lophn-agent slice flow E2E: answer-question(docs/flows/answer-question.md). 실제 shell(headless)·
// core(제품 runtime child를 띄우는 기동)를 임시 LOPHN_HOME으로 띄우고, model이 끼는 단계는
// tools/fake-provider(loopback fixture server)로 검증하며 실제 ~/.lophn은 열지 않는다.
// - 2: 사람은 대화 도크의 질문 칸에서 질문 글·이유·설명 있는 선택지·추천 이유를 읽고, 고르기만
//   해서는 답이 확정되지 않음을 본다(고른 뒤에도 질문은 답이 없다).
// - 3: 선택 클릭만으로는 답이 아니다. 보내야 해당 질문의 답으로 접수되고 질문을 낸 run이
//   같은 run으로 이어진다(questions#R7, waiting-and-recovery#R1).
// - 6의 사람 쪽: 답을 정하지 못하면 미루기, 필요 없으면 이유와 함께 취소한다. 둘 다 답 없음으로
//   남고, 질문을 낸 run은 답 없음(stopped)으로 끝난다. 답 없음으로 끝난 run 뒤의 요청은 사람이
//   계속하라고 확인해야 시작하므로 다음 질문의 요청은 그 확인을 거친다.
// 질문을 낸 run은 답을 기다린다(WaitRun의 질문 갈래). 답 접수와 실제 적용 결과를 나란히 보는
// 자리는 things-to-confirm 화면(shell#T29)이다.
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

const NOTED = {
  protocol: "messages" as const,
  reply: {
    text: "Thanks, I will keep the wording.",
    usage: { input: 40, output: 9 },
    stop: "end" as const,
  },
};

// 요청 하나(run 하나)마다 질문 하나. 질문을 낸 run은 답을 기다리므로 미루기·취소로 끝난 run은
// model을 다시 부르지 않고, 답으로 이어진 run만 한 번 더 부른다.
const SCRIPT = {
  steps: [
    { id: "ask-first", ...ask(FIRST, true) },
    { id: "ask-second", ...ask(SECOND, false) },
    { id: "ask-third", ...ask(THIRD, false) },
    { id: "noted-third", ...NOTED },
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
      /** 답 없음으로 끝난 run 뒤의 요청을 사람이 계속하라고 확인한다(run-loop R6). */
      const continueQueued = async () => {
        const deadline = Date.now() + 60_000;
        for (;;) {
          const listed = await mustCall(flow, {
            kind: "read",
            resource: "runs",
            method: "list",
            body: {},
          });
          const runs = listed["runs"] as {
            id: string;
            state: string;
            start_after: string | null;
            accepted_seq: string;
            state_seq: string;
          }[];
          const queued = runs.find((run) => run.state === "accepted");
          const before = runs.find((run) => run.id === queued?.start_after);
          if (
            queued !== undefined && before !== undefined &&
            before.state === "finished"
          ) {
            await mustCall(flow, {
              kind: "command",
              resource: "runs",
              method: "confirm-next",
              body: commandBody({ run: queued.id, predecessor: before.id }, {
                accepted_seq: queued.accepted_seq,
                predecessor_state_seq: before.state_seq,
              }),
            });
            return;
          }
          assert(Date.now() < deadline, "이어 갈 요청이 접수되지 않았다");
          await delay(250);
        }
      };
      /** 질문 하나를 만드는 요청을 보내고 그 질문이 칸에 설 때까지 기다린다. */
      const askWith = async (text: string, want: string, after = false) => {
        const before = (await questions()).length;
        await flow.type(INPUT, text);
        await flow.click(SEND);
        await untilConfirmed();
        if (after) await continueQueued();
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
          await askWith("Change it later.", SECOND, true);
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

          // 세 번째 질문은 그대로 기다린다.
          await askWith("Rewrite it now.", THIRD, true);
          assertEquals((await questions("pending")).length, 1);
        },
      );

      await t.step(
        "lophn-agent/questions#R7 lophn-agent/harness/waiting-and-recovery#R1: 3 고른 선택지를 보내면 해당 질문의 답으로 접수되고 질문을 낸 run이 이어진다",
        async () => {
          const [third] = await questions("pending");
          assert(third !== undefined, "세 번째 질문이 없다");
          await flow.click("[data-option='keep']");
          await untilStrip(
            `document.querySelector("[data-option='keep']")?.getAttribute("aria-checked") === "true"`,
            "선택지가 골라지지 않았다",
          );
          assertEquals(
            (await questions()).find((item) => item.id === third.id)?.status,
            "pending",
          );
          await flow.click("[data-send-answer]");
          const answered = await untilQuestion(
            third.id,
            (row) => row.status === "answered",
            "답이 접수되지 않았다",
          );
          assertEquals(answered.answer?.kind, "option");
          // 같은 run이 이어져 model을 한 번 더 부른다.
          const deadline = Date.now() + 120_000;
          while (
            !provider.requests().some((entry) =>
              entry.matchedStep === "noted-third"
            )
          ) {
            assert(Date.now() < deadline, "질문을 낸 run이 이어지지 않았다");
            await delay(250);
          }
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await provider.close();
    }
  },
});
