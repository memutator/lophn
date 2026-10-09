// lophn-agent slice flow E2E: ask-lophn-help(docs/flows/ask-lophn-help.md). 실제 shell(headless)·
// core(제품 runtime child)를 임시 LOPHN_HOME으로 띄우고 model은 이 시험의 loopback 응답 server가
// 낸다. 설치 안내는 임시 설치 root(LOPHN_INSTALL_ROOT)에 동봉 Settings 안내를 실제로 써서
// 읽힌다. 실제 ~/.lophn과 실제 provider는 쓰지 않는다.
// - 1·2·3: settings 화면의 [Ask lophn]으로 연 도크에서 설정 뜻을 묻는다. lophn 역할은 설치 판의
//   안내 목록·Settings 안내와 공개 설정 정의·현재 값·출처·적용 시점을 읽기 tool로만 읽고 답한다.
//   설명을 들은 것만으로는 설정이 바뀌지 않는다.
// - 4: 바꾸려면 lophn이 선택지와 추천 이유를 question으로 묻는다. 고르기만으로는 답이나 변경이
//   아니고, 미루면 답 없음으로 남고 설정은 그대로다.
// 볼 수 없는 것(이어보냄): 5~7 답 확정·machine 적용은 답 확정 경로 결함(followups 49: ports.wait가
// WaitRun의 질문 갈래를 부르지 않아 질문을 만든 run이 끝나고 questions/answer가 "the run is
// finished"로 거절된다) 때문에 볼 수 없다. 또 제품 `question.submit` tool은 선택지 action을
// null로만 받고 `settingChangeQuestion`의 고정 action(ApplySettings)을 싣는 통로
// (roles/lophn/question-submission.ts `draftSubmission`)가 runtime에 이어져 있지 않아, model이 낸
// 설정 질문의 선택지에는 고정 변경이 실리지 않는다.
import { assert, assertEquals } from "@std/assert";

import { buildReply } from "../../tools/fake-provider/semantic.ts";
import type { SemanticReply } from "../../tools/fake-provider/types.ts";
import { guideInstallFixture } from "../../packages/documents/versions/testing/mod.ts";
import { e2eEnabled } from "../harness.ts";
import {
  commandBody,
  delay,
  type FlowShell,
  mustCall,
  openFlowShell,
  removeHome,
} from "../flow-support.ts";

const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const MODEL = "claude-sonnet-4-5";

const INPUT = "[data-composer-input]";
const SEND = "[data-send]";
const DOCK = "[data-dock]";
const READY = "[data-question-text='ready']";

const KEY = "shell.reading_width";
const GUIDE_PATH = "roles/lophn/guides/settings.md";
const ASK = "What does the reading width setting do?";
const EXPLAIN =
  "Reading width sets how wide every document reads. It is the default width now.";
const CHANGE = "Make documents narrower.";
const PROMPT = "Which reading width should documents use?";

type Step = (body: string) => SemanticReply | Promise<SemanticReply>;

/** 요청마다 다음 step 함수로 Anthropic messages 응답을 낸다. 요청 본문은 남긴다. */
function startDynamicProvider(steps: Step[]) {
  const bodies: string[] = [];
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const text = await request.text();
      const path = new URL(request.url).pathname;
      if (request.method !== "POST" || !path.endsWith("/messages")) {
        return Response.json({ error: "unexpected" }, { status: 500 });
      }
      const step = steps[bodies.length];
      bodies.push(text);
      if (step === undefined) {
        return Response.json({ error: "exhausted" }, { status: 500 });
      }
      const built = buildReply("messages", await step(text));
      return new Response(built.body ?? "", {
        status: built.status,
        headers: built.headers,
      });
    },
  );
  return {
    url: `http://127.0.0.1:${server.addr.port}`,
    calls: () => bodies.length,
    body: (index: number) => bodies[index] ?? "",
    close: () => server.shutdown(),
  };
}

function toolCall(id: string, name: string, args: unknown): SemanticReply {
  return {
    text: "",
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
    usage: { input: 30, output: 9 },
    stop: "tool_calls",
  };
}

const option = (key: string, label: string, description: string) => ({
  key,
  label,
  description,
  evidence: [],
  adoption: null,
  action: null,
});

const STEPS: Step[] = [
  // 첫 요청(설명): 안내 목록 → Settings 안내 → 설정 정의·현재 값 → 답.
  () => toolCall("toolu_guides", "lophn.guide", {}),
  () => toolCall("toolu_guide", "lophn.guide", { feature: "Settings" }),
  () => toolCall("toolu_setting", "setting.read", { keys: [KEY] }),
  () => ({ text: EXPLAIN, usage: { input: 40, output: 12 }, stop: "end" }),
  // 둘째 요청(변경): 현재 값을 다시 읽고 선택지와 추천을 question으로 묻는다.
  () => toolCall("toolu_reread", "setting.read", { keys: [KEY] }),
  () =>
    toolCall("toolu_ask", "question.submit", {
      prompt: PROMPT,
      reason: "the reading width changes every open document at once",
      options: [
        option(
          "keep",
          "Keep the default width",
          "Now: default. Nothing changes.",
        ),
        option(
          "narrow",
          "Use the narrow width",
          "Now: default. New: narrow. Every document reads narrower at the next check.",
        ),
      ],
      recommendation: {
        option_key: "narrow",
        explanation: "You asked for narrower documents.",
      },
      expires_at: null,
    }),
  () => ({
    text: "Pick a width when you are ready.",
    usage: { input: 40, output: 9 },
    stop: "end",
  }),
];

type RunRow = { id: string; state: string; outcome: { kind: string } | null };

type QuestionRow = {
  id: string;
  status: string;
  answer: unknown;
  closed_reason: string | null;
};

async function setDefaults(flow: FlowShell, endpoint: string): Promise<void> {
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
      endpoint,
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
}

Deno.test({
  name:
    "lophn-agent/roles/lophn#R1 lophn-agent/roles/lophn#R20 lophn-agent/harness/tools#R20 lophn-agent/questions#R6 flow ask-lophn-help: settings 화면에서 물은 설정을 lophn이 설치 안내와 공개 설정으로 설명하고, 바꾸려면 질문으로 묻되 고르기·미루기로는 설정이 바뀌지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const install = await Deno.makeTempDir({ prefix: "lophn-e2e-install-" });
    const guideText = await Deno.readTextFile(
      new URL(
        "../../packages/lophn-agent/roles/lophn/guides/settings.md",
        import.meta.url,
      ),
    );
    guideInstallFixture("1.0.0", [
      { title: "Settings", path: GUIDE_PATH, text: guideText },
    ], `${install}/guides`);
    const before = Deno.env.get("LOPHN_INSTALL_ROOT");
    Deno.env.set("LOPHN_INSTALL_ROOT", install);
    const provider = startDynamicProvider(STEPS);
    const flow = await openFlowShell({ start: "lophn" });
    const home = flow.home;
    try {
      await setDefaults(flow, provider.url);
      const assignments = await mustCall(flow, {
        kind: "read",
        resource: "assignments",
        method: "list",
        body: {},
      });
      const agent = (assignments.assignments as { id: string; role: string }[])
        .find((entry) => entry.role === "lophn");
      assert(agent !== undefined, "lophn assignment가 없다");
      const runsOf = async (): Promise<RunRow[]> =>
        (await mustCall(flow, {
          kind: "read",
          resource: "runs",
          method: "list",
          body: { assignment: agent.id },
        })).runs as RunRow[];
      const setting = async () => {
        const read = await mustCall(flow, {
          kind: "read",
          resource: "settings",
          method: "get",
          body: { keys: [KEY] },
        });
        return JSON.stringify(read.settings);
      };
      const questions = async (): Promise<QuestionRow[]> =>
        (await mustCall(flow, {
          kind: "read",
          resource: "questions",
          method: "list",
          body: {},
        })).questions as QuestionRow[];
      const dockText = async () =>
        String(
          await flow.evaluate(
            `document.querySelector(${
              JSON.stringify(DOCK)
            })?.innerText ?? null`,
          ),
        ).slice(0, 600);
      const untilRuns = async (count: number) => {
        const deadline = Date.now() + 180_000;
        for (;;) {
          const rows = await runsOf();
          if (
            rows.length === count &&
            rows.every((row) => row.outcome !== null)
          ) return rows;
          if (Date.now() > deadline) {
            throw new Error(
              `run이 끝나지 않았다 | runs=${
                JSON.stringify(rows)
              } calls=${provider.calls()} dock=${
                JSON.stringify(await dockText())
              }`,
            );
          }
          await delay(250);
        }
      };
      const initial = await setting();

      await t.step(
        "lophn-agent/roles/lophn#R1 lophn-agent/roles/lophn#R20 lophn-agent/harness/tools#R20 platform/settings#R17: 1·2·3 settings 화면에서 물으면 설치 안내와 공개 설정을 읽어 답하고 설정은 그대로다",
        async () => {
          await flow.click('[data-screen="settings"]');
          await flow.until(
            `document.querySelector("[data-action='ask-lophn']") !== null`,
            "settings 화면에 [Ask lophn]이 없다",
          );
          await flow.click("[data-action='ask-lophn']");
          await flow.until(
            `document.querySelector(${JSON.stringify(DOCK)}) !== null`,
            "도크가 열리지 않았다",
          );
          await flow.until(
            `document.querySelector("[data-new-session]") !== null || document.querySelector(${
              JSON.stringify(INPUT)
            }) !== null`,
            "새 세션 단추가 서지 않았다",
          );
          if (
            await flow.evaluate(
              `document.querySelector(${JSON.stringify(INPUT)}) === null`,
            ) === true
          ) {
            await flow.click("[data-new-session]");
          }
          await flow.until(
            `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
            "입력칸이 서지 않았다",
          );
          await flow.type(INPUT, ASK);
          await flow.click(SEND);
          const rows = await untilRuns(1);
          assertEquals(rows[0]!.outcome?.kind, "completed");
          assertEquals(provider.calls(), 4);
          // 2: 설치 판의 안내 목록과 Settings 안내 본문, 공개 설정의 현재 값·출처·적용 시점.
          const listed = provider.body(1);
          assert(listed.includes("Settings"), "안내 목록에 Settings가 없다");
          assert(listed.includes("1.0.0"), "안내 목록에 설치 판이 없다");
          assert(
            provider.body(2).includes("How a change is applied"),
            "Settings 안내 본문을 읽지 않았다",
          );
          const read = provider.body(3);
          for (
            const word of [KEY, "source_layer", "current_check", "narrow"]
          ) {
            assert(read.includes(word), `설정 읽기에 ${word}가 없다`);
          }
          // 3: 사람은 답을 듣는다. 설명만으로는 설정이 바뀌지 않는다.
          await flow.until(
            `document.querySelector(${
              JSON.stringify(DOCK)
            })?.innerText.includes(${JSON.stringify(EXPLAIN)})`,
            "도크에 답이 없다",
          );
          assertEquals(await setting(), initial);
          assertEquals((await questions()).length, 0);
        },
      );

      await t.step(
        "lophn-agent/roles/lophn#R21 lophn-agent/questions#R3 lophn-agent/questions#R4 lophn-agent/questions#R6 lophn-agent/questions#R8: 4 바꾸려면 선택지와 추천을 질문으로 묻고, 고르기·미루기로는 설정이 바뀌지 않는다",
        async () => {
          await flow.type(INPUT, CHANGE);
          await flow.click(SEND);
          const rows = await untilRuns(2);
          assertEquals(provider.calls(), 7);
          assert(
            provider.body(5).includes("current_check"),
            "질문 전에 현재 설정을 읽지 않았다",
          );
          // 질문 run은 답을 기다리지 않고 끝난다(답 확정 경로 결함, 머리 주석).
          assert(rows.every((row) => row.outcome !== null));
          await flow.until(
            `document.querySelector(${
              JSON.stringify(READY)
            })?.textContent === ${JSON.stringify(PROMPT)}`,
            "질문이 칸에 서지 않았다",
            120_000,
          );
          assertEquals(
            await flow.text("[data-option='narrow'] [data-option-description]"),
            "Now: default. New: narrow. Every document reads narrower at the next check.",
          );
          assertEquals(await flow.count("[data-recommended]"), 1);
          assert(
            (await flow.text("[data-recommendation]"))?.includes(
              "You asked for narrower documents.",
            ) === true,
            "추천 이유가 없다",
          );
          const [question] = await questions();
          assert(question !== undefined, "질문이 없다");
          assertEquals(question.status, "pending");

          // 고르기만으로는 답도 변경도 아니다.
          await flow.click("[data-option='narrow']");
          await flow.until(
            `document.querySelector("[data-option='narrow']")?.getAttribute("aria-checked") === "true"`,
            "선택지가 골라지지 않았다",
          );
          await delay(1_000);
          const picked = (await questions()).find((row) =>
            row.id === question.id
          );
          assertEquals(picked?.status, "pending");
          assertEquals(picked?.answer, null);
          assertEquals(await setting(), initial);

          // 미루기는 답 없음으로 남고 설정은 그대로다.
          await flow.click("[data-later]");
          const deadline = Date.now() + 60_000;
          let row = picked;
          while (row?.status !== "cancelled") {
            assert(
              Date.now() < deadline,
              `미루기가 접수되지 않았다: ${JSON.stringify(row)}`,
            );
            await delay(250);
            row = (await questions()).find((item) => item.id === question.id);
          }
          assertEquals(row.closed_reason, "deferred");
          assertEquals(row.answer, null);
          assertEquals(await setting(), initial);
        },
      );
    } finally {
      await flow.close();
      await removeHome(home);
      await provider.close();
      if (before === undefined) Deno.env.delete("LOPHN_INSTALL_ROOT");
      else Deno.env.set("LOPHN_INSTALL_ROOT", before);
      await Deno.remove(install, { recursive: true });
    }
  },
});
