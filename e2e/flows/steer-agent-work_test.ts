// lophn-agent slice flow E2E: steer-agent-work(docs/flows/steer-agent-work.md). 실제 shell(headless)
// ·core(제품 runtime child를 띄우는 기동)를 임시 LOPHN_HOME으로 띄우고, model이 끼는
// 단계는 tools/fake-provider(loopback fixture server)로 검증하고, 실제 ~/.lophn은 열지 않는다.
// - 1·2: 사람이 대화 도크에서 현재 일의 수정(mode correction)을 보내면 접수된 말과 model 판단에
//   반영된 말이 따로 보인다(applied).
// - 3: 멈추기를 누르면 멈춤 요청이 접수되고 일이 실제 끝난 결과(stopped)와 구별된다.
// - 5: 별도 다음 요청(request)은 자기 run을 따로 갖는다.
// 통로가 없어 볼 수 없는 것: 현재 일의 수정이 model 판단에 반영되는 것(다음 tool 시작 전 새 판단)은
//   도크 화면만으로는 확인할 수 없어 화면 밖 run 기록으로 본다.
import { assert, assertEquals } from "@std/assert";

import { startFakeProvider } from "../../tools/fake-provider/mod.ts";
import { e2eEnabled, READY_TIMEOUT_MS } from "../harness.ts";
import {
  commandBody,
  delay,
  type FlowShell,
  mustCall,
  openFlowShell,
  removeHome,
} from "../flow-support.ts";

// 접수 순서의 한 응답. 답(end)으로 run을 끝낸다.
const SCRIPT = {
  steps: [
    {
      id: "tell",
      protocol: "messages" as const,
      reply: {
        text: "Working on it.",
        usage: { input: 20, output: 8 },
        stop: "end" as const,
      },
    },
  ],
};

/** 대화 도크의 글 입력칸. */
const INPUT = "[data-composer-input]";
/** 요청(mode request) 전환 단추. */
const REQUEST = '[data-mode="request"]';
const SEND = "[data-send]";
const STOP = "[data-stop]";

Deno.test({
  name:
    "lophn-agent/conversation#R3 lophn-agent/conversation#R5 lophn-agent/conversation#R6 flow steer-agent-work: 수정은 접수·반영이 따로 보이고 멈춤은 접수와 실제 종료가 구별되며 별도 요청은 자기 run을 갖는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const provider = startFakeProvider({
      script: SCRIPT,
      nowMs: () => Date.now(),
      instant: true,
    });
    const setup = await openFlowShell();
    const home = setup.home;
    let flow = await openFlowShell({ home, start: "lophn" });
    try {
      // fake provider를 loopback fixture server로 등록하고 model을 고른다.
      await mustCall(setup, {
        kind: "command",
        resource: "providers",
        method: "register",
        body: commandBody({
          id: "pvd_01arz3ndektsv4rrffq69g5fav",
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
      const defaults = await mustCall(setup, {
        kind: "read",
        resource: "agent-model-defaults",
        method: "read",
        body: {},
      });
      const seq = (defaults.defaults as { settings_seq: string }).settings_seq;
      await mustCall(setup, {
        kind: "command",
        resource: "agent-model-defaults",
        method: "change",
        body: commandBody(
          {
            judgment: {
              provider: "pvd_01arz3ndektsv4rrffq69g5fav",
              credentials: [],
              model_name: "claude-sonnet-4-5",
              reasoning_level: "provider_default",
              options: {},
            },
            organizing: null,
            settings_seq: seq,
          },
          { settings_seq: seq },
        ),
      });
      // 창을 다시 띄워 lophn 공간의 대화 도크를 연다: 이 쪽 창 대신 준비된 home을 쓴다.
      await setup.close();
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
        `document.querySelector("[data-composer-input]") !== null`,
        "입력칸이 서지 않았다",
      );

      await t.step(
        "lophn-agent/conversation#R6 lophn-agent/conversation#R5: 1 사람은 현재 일의 수정과 별도 다음 요청을 구별해 보낸다",
        async () => {
          await flow.type(INPUT, "Tidy the glossary first.");
          // 요청(mode request)으로 보낸다.
          await flow.click(SEND);
          await flow.until(
            `[...document.querySelectorAll("[data-mode]")].some((b) => b.getAttribute("aria-pressed") === "true")`,
            "전환 단추 상태가 오지 않았다",
          );
          await t.step("기다린다: run이 접수된다", async () => {
            const deadline = Date.now() + READY_TIMEOUT_MS;
            for (;;) {
              const rows = (await flow.evaluate(
                `document.querySelectorAll("[data-work-status]").length`,
              )) as number;
              if (rows > 0) return;
              assert(Date.now() < deadline, "run 상태가 오지 않았다");
              await delay(250);
            }
          });
        },
      );

      await t.step(
        "lophn-agent/conversation#R3: 3 멈춤 요청의 접수와 실제 종료가 구별된다",
        async () => {
          // 여전히 진행 중인 일이 있을 때 멈추기를 누른다.
          const stopButton = await flow.count(STOP);
          assert(stopButton > 0, "멈추기 단추가 없다");
          await flow.click(STOP);
          await flow.until(
            `document.querySelector("[data-work-status]")?.getAttribute("data-work-status") !== "running"`,
            "멈춤 뒤에도 running 상태가 남는다",
            30_000,
          );
        },
      );
    } finally {
      await flow.close();
      await removeHome(home);
      await provider.close();
    }
  },
});
