// lophn-agent slice flow E2E: steer-agent-work(docs/flows/steer-agent-work.md). 실제 shell(headless)·
// core(제품 runtime child를 띄우는 기동)를 임시 LOPHN_HOME으로 띄우고, model이 끼는 단계는
// tools/fake-provider(loopback fixture server)로 검증하며 실제 ~/.lophn은 열지 않는다.
// - 1: 사람이 대화 도크에서 현재 일의 수정(correction)을 보내면 접수된 말(received)과 실제 판단에
//   반영된 말(applied)이 따로 보인다. 반영은 다음 model call에서 일어나고 그 call의 입력에 수정
//   원문이 들어간다(fixture server가 받은 요청으로 본다).
// - 2: 반영의 안쪽 처리(접수 순서 보존·다음 판단)는 사람에게 보이지 않는다. 이 시험은 화면 표시와
//   그 call의 입력으로만 본다.
// - 3: 멈추기를 누르면 일이 실제로 끝나고 결과가 멈춤(stopped)으로 남는다(정상 종료 done과 다르다).
// - 5: 별도 다음 요청은 정상 종료 뒤 자기 run에서 시작하고, 멈춤 뒤에는 접수만 남고 자동으로
//   시작하지 않는다.
// 통로가 없어 볼 수 없는 것: 진행 중 판단은 느린 응답(gate)으로 붙들어 두고 보므로 실제 model
// 지연과 같지 않다. 질문·approval 대기 중 입력은 그 대기를 만드는 흐름(answer-question·
// approve-action)이 본다. 멈춤 뒤 보존된 요청은 run이 접수된 채 남아 도크에는 진행 중으로
// 보이고, 사람이 다시 맡기기를 고르는 화면(roles)이 실제 시작을 확인한다.
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

/** 대화 도크의 글 입력칸. */
const INPUT = "[data-composer-input]";
const SEND = "[data-send]";
const STOP = "[data-stop]";
const REQUEST = '[data-mode="request"]';
const CORRECTION = '[data-mode="correction"]';
const STATUS = "[data-work-status]";

const FIRST = "Tidy the glossary.";
const CHANGE = "Tidy the glossary first.";
const NEXT = "Now rename the glossary.";
const LAST = "And tidy the index.";

/** 첫 판단 하나를 붙들어 두는 gate. 진행 중인 동안 시험이 수정을 보낸다. */
const FIRST_CALL = "answer-first";

// anthropic-messages stream 하나. 마지막 조각을 gate로 붙들어 call이 진행 중인 동안 시험을 한다.
function slowAnswer(id: string, gate: string, text: string) {
  const frames = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
    `event: content_block_delta\ndata: ${
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      })
    }\n\n`,
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
  return {
    id,
    protocol: "messages" as const,
    response: {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      chunks: [
        { bytes: frames[0]! },
        { bytes: frames.slice(1).join(""), gate },
      ],
    },
  };
}

// 접수 순서의 model 응답 셋. 첫 판단은 붙들려 있고, 수정이 반영된 다음 판단이 일을 끝낸다.
const SCRIPT = {
  steps: [
    slowAnswer("first", FIRST_CALL, "Working on the glossary."),
    {
      id: "after-change",
      protocol: "messages" as const,
      reply: {
        text: "The glossary is tidy.",
        usage: { input: 40, output: 9 },
        stop: "end" as const,
      },
    },
    slowAnswer("second", "answer-second", "Renaming the glossary."),
  ],
};

Deno.test({
  name:
    "lophn-agent/conversation#R3 lophn-agent/conversation#R5 lophn-agent/conversation#R6 flow steer-agent-work: 수정은 접수와 반영이 따로 보이고 멈춤은 실제 종료로 남으며 다음 요청은 자기 run을 갖는다",
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
      // 사람 command로 fixture provider를 등록하고 판단 model을 고른다. 등록 화면(shell#T26)이
      // 아직 없어 같은 사람 command를 core 통로로 낸다(connect-provider가 화면 조작을 본다).
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

      const assignments = await mustCall(flow, {
        kind: "read",
        resource: "assignments",
        method: "list",
        body: { role: "lophn" },
      });
      const agent = (assignments.assignments as { id: string }[])[0];
      assert(agent !== undefined, "lophn assignment가 없다");

      /** 지금 세션의 run들(사람 token의 runs/list 읽기). */
      const runs = async () => {
        const listed = await mustCall(flow, {
          kind: "read",
          resource: "runs",
          method: "list",
          body: { assignment: agent.id },
        });
        return listed.runs as {
          id: string;
          state: string;
          outcome: { kind: string } | null;
        }[];
      };
      /** 사람 말마다의 접수·반영 표시. 접수 순서다. */
      const deliveries = async () =>
        JSON.parse(
          String(
            await flow.evaluate(
              `JSON.stringify([...document.querySelectorAll("[data-actor='user']")].map((el) => el.querySelector("[data-delivery]")?.getAttribute("data-delivery") ?? null))`,
            ),
          ),
        ) as (string | null)[];
      const lastDelivery = async () => (await deliveries()).at(-1) ?? null;
      /** 마지막 사람 말이 접수로 확정될 때까지 기다린다. 임시 표시(sending)는 접수가 아니다. */
      const untilConfirmed = () =>
        flow.until(
          `(() => { const rows = [...document.querySelectorAll("[data-actor='user']")]; const last = rows.at(-1)?.querySelector("[data-delivery]")?.getAttribute("data-delivery"); return rows.length > 0 && last !== null && last !== undefined && last !== "sending"; })()`,
          "보낸 말이 접수로 확정되지 않았다",
        );
      /** 도크 상태 줄의 말. run이 없으면 null이다. */
      const status = async () =>
        await flow.evaluate(
          `document.querySelector(${
            JSON.stringify(STATUS)
          })?.getAttribute("data-work-status") ?? null`,
        );
      /** 도크가 마지막으로 보인 글. 실패했을 때 이유를 담는다. */
      const dockText = async () =>
        String(
          await flow.evaluate(
            `document.querySelector("[data-dock]")?.innerText ?? null`,
          ),
        ).slice(0, 400);
      /** 상태 줄이 `want`가 될 때까지 기다린다. 못 되면 지금 사실을 담아 던진다. */
      const untilStatus = async (want: string) => {
        try {
          await flow.until(
            `document.querySelector(${
              JSON.stringify(STATUS)
            })?.getAttribute("data-work-status") === ${JSON.stringify(want)}`,
            `상태가 ${want}가 되지 않았다`,
            180_000,
          );
        } catch (error) {
          throw new Error(
            `${(error as Error).message} | runs=${
              JSON.stringify(await runs())
            } model_calls=${provider.requests().length} dock=${
              JSON.stringify(await dockText())
            }`,
          );
        }
      };
      /** fixture server가 받은 call 수가 `count`가 될 때까지 기다린다. */
      const untilCalls = async (count: number) => {
        const deadline = Date.now() + 120_000;
        for (;;) {
          if (provider.requests().length >= count) return;
          assert(
            Date.now() < deadline,
            `판단이 ${count}번째 call에 이르지 않았다: ${
              JSON.stringify(await runs())
            }`,
          );
          await delay(250);
        }
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
      // 도크는 현재 기록을 먼저 읽는다. lophn 담당이 서면 새 세션 단추가 열린다.
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
        "lophn-agent/conversation#R5 lophn-agent/conversation#R6: 1 다음 요청은 자기 run으로 접수된다",
        async () => {
          await flow.type(INPUT, FIRST);
          await flow.click(SEND);
          // 접수: 보낸 말이 기록에 남고 담당 run이 붙는다. 판단에 반영된 표시는 아직 아니다.
          await untilConfirmed();
          assertEquals(await lastDelivery(), "received");
          // 판단이 시작되어 진행 중으로 선다. 그 call은 시험이 붙들고 있다.
          await untilCalls(1);
          await untilStatus("in-progress");
          const started = await runs();
          assertEquals(started.length, 1, "요청 하나가 run 하나를 갖지 않았다");
          assertEquals(started[0]!.state, "running");
          assertEquals(started[0]!.outcome, null);
        },
      );

      await t.step(
        "lophn-agent/conversation#R3 lophn-agent/conversation#R5: 1·2 진행 중 보낸 수정은 접수로 남고 다음 판단에 반영된다",
        async () => {
          // 고칠 지금 일이 있으므로 수정으로 보낼 수 있다.
          const disabled = await flow.evaluate(
            `document.querySelector(${
              JSON.stringify(CORRECTION)
            })?.hasAttribute("disabled") ?? true`,
          );
          assertEquals(disabled, false, "진행 중인데 수정을 보낼 수 없다");
          await flow.type(INPUT, CHANGE);
          await flow.click(CORRECTION);
          await flow.until(
            `document.querySelector("[data-composer]")?.getAttribute("data-composer") === "correction"`,
            "입력칸이 수정으로 바뀌지 않았다",
          );
          await flow.click(SEND);
          // 접수와 반영이 따로 보인다: 판단이 도는 동안에는 접수 표시뿐이고 일은 그대로 진행 중이다.
          await untilConfirmed();
          assertEquals(await lastDelivery(), "received");
          const held = await runs();
          assertEquals(held.length, 1, "수정이 새 run을 만들었다");
          assertEquals(held[0]!.state, "running");
          assertEquals(await status(), "in-progress");

          // 붙들어 둔 판단을 놓으면 다음 판단이 수정을 반영하고 일이 정상 종료한다.
          provider.release(FIRST_CALL);
          await flow.until(
            `[...document.querySelectorAll("[data-actor='user']")].at(-1)?.querySelector("[data-delivery]")?.getAttribute("data-delivery") === "applied"`,
            "수정이 반영으로 바뀌지 않았다",
            180_000,
          );
          assertEquals(await lastDelivery(), "applied");
          await untilStatus("done");
          const finished = await runs();
          assertEquals(finished.length, 1);
          assertEquals(finished[0]!.outcome?.kind, "completed");
          // 반영은 실제 판단이다: 반영한 call의 입력에 수정 원문이 들어 있다.
          const second = provider.requests()[1];
          assert(second !== undefined, "두 번째 판단이 없었다");
          assert(
            JSON.stringify(second.body).includes(CHANGE),
            "수정 원문이 판단 입력에 없다",
          );
        },
      );

      await t.step(
        "lophn-agent/conversation#R3 lophn-agent/conversation#R6: 3·5 멈춤은 실제 종료로 남고 멈춤 뒤 요청은 자동으로 시작하지 않는다",
        async () => {
          // 별도 다음 요청: 정상 종료 뒤라 자기 run에서 시작한다.
          await flow.click(REQUEST);
          await flow.type(INPUT, NEXT);
          await flow.click(SEND);
          await untilCalls(3);
          await untilConfirmed();
          await untilStatus("in-progress");
          const started = await runs();
          assertEquals(started.length, 2, "다음 요청이 새 run을 받지 않았다");
          assertEquals(started[1]!.state, "running");
          // 멈춤은 도크가 마지막으로 읽은 run 값으로 비교한다. 도크는 3초마다 현재 기록을 다시
          // 읽으므로 한 박자를 기다려 진행 중인 run의 값을 도크가 갖게 한다.
          await delay(4_000);

          // 멈추기: 일이 실제로 끝나고 결과가 멈춤으로 남는다(정상 종료의 done과 다르다).
          await flow.click(STOP);
          await untilStatus("stopped");
          const stopped = await runs();
          assertEquals(stopped.length, 2);
          assertEquals(stopped[1]!.state, "finished");
          assertEquals(stopped[1]!.outcome?.kind, "stopped");

          // 멈춤 뒤 다음 요청은 접수만 남고 자동으로 시작하지 않는다(사람이 다시 골라야 한다).
          const calls = provider.requests().length;
          await flow.click(REQUEST);
          await flow.type(INPUT, LAST);
          await flow.click(SEND);
          await untilConfirmed();
          assertEquals(await lastDelivery(), "received");
          const kept = await runs();
          assertEquals(kept.length, 3, "멈춤 뒤 요청이 run을 받지 않았다");
          assertEquals(kept[2]!.state, "accepted");
          await delay(5_000);
          assertEquals(
            provider.requests().length,
            calls,
            "멈춤 뒤 요청이 자동으로 시작했다",
          );
          assertEquals((await runs())[2]!.state, "accepted");
          // 남은 입력과 이미 끝난 일의 결과는 사라지지 않는다.
          assertEquals(await deliveries(), [
            "received",
            "applied",
            "received",
            "received",
          ]);
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await provider.close();
    }
  },
});
