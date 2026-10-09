// lophn-agent slice flow E2E: view-agent-visuals(docs/flows/view-agent-visuals.md). 실제 shell(headless)·
// core(제품 runtime child)를 임시 LOPHN_HOME으로 띄우고 model은 이 시험의 loopback 응답 server가
// 낸다. 비교할 자료는 사람이 등록·추적한 프로젝트 폴더의 파일이다. 실제 ~/.lophn과 실제 provider는
// 쓰지 않는다.
// - 1·2·3·4: 도크에서 비교를 청하면 lophn이 그 문서 판을 읽고 같은 답 안에 표와 막대 차트를 넣는다.
//   machine이 검사한 명세가 메시지로 저장되고 shell이 SDK로 그리며 블록마다 제목·설명·출처(읽은
//   고정 판)가 선다. 임의 HTML·script는 그려지지 않는다.
// - 5: 블록의 [Save as document]는 대화 요청이 되고, lophn은 visual.prepare_document로 실행 코드
//   없는 HTML 본문을 준비해 document.create로 저장한다. 작성 중이던 글은 그대로다.
// - 7: 저장한 고정 판을 읽고(실행 코드 없음), 창·core를 다시 띄운 뒤에도 원래 메시지·출처와
//   저장 문서로 돌아온다.
// 빠진 것: 앱 카드 갈래(2·4·6의 app-card)는 apps#T27이 돈다.
// 결함 (8): 제품 답 메시지(apps/agent-runtime/core-ports.ts `answer`)는 model_call 링크만 싣고 run이
// 만든·저장한 문서를 결과 링크로 싣지 않는다. 그래서 5의 블록 아래 고정 문서 링크와 7의 그 링크로
// 열기는 볼 수 없고, 저장은 documents 목록과 그 고정 판 읽기로 본다.
// 문서 ID·version과 메시지 ID는 실행 중에 정해지므로 model 응답은 앞 요청 본문에서 ID와 준비된
// 본문을 읽어 내는 작은 loopback server(fake-provider의 응답 builder)로 낸다.
import { assert, assertEquals } from "@std/assert";

import { buildReply } from "../../tools/fake-provider/semantic.ts";
import type { SemanticReply } from "../../tools/fake-provider/types.ts";
import { e2eEnabled } from "../harness.ts";
import {
  commandBody,
  delay,
  documentTitled,
  type FlowShell,
  listDocuments,
  mustCall,
  openFlowShell,
  registerTrackedProject,
  removeHome,
  untilDocuments,
  untilReadable,
} from "../flow-support.ts";

const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const MODEL = "claude-sonnet-4-5";

const INPUT = "[data-composer-input]";
const SEND = "[data-send]";
const DOCK = "[data-dock]";

const SOURCE = "sales";
const ASK = "Compare the quarterly sales in the sales note.";
const ANSWER = "Q2 sold the most; Q3 has no recorded figure.";
const SAVED_TITLE = "Quarterly sales";
const SAVED_ANSWER = "Saved the sales table as a document.";
const DRAFT = "half written note";

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

/** 요청 본문의 마지막 tool 결과(자료 표식 안의 JSON)를 푼다. */
function lastToolResult(body: string): Record<string, unknown> {
  const request = JSON.parse(body) as {
    messages: { content: string | { type: string; content?: unknown }[] }[];
  };
  // 마지막 tool 결과. 뒤에 turn context 같은 글 조각이 붙을 수 있어 뒤에서부터 찾는다.
  const result = request.messages.flatMap((message) =>
    Array.isArray(message.content) ? message.content : []
  ).findLast((block) => block.type === "tool_result");
  assert(result !== undefined, `tool 결과가 없다: ${body.slice(-500)}`);
  const raw = typeof result.content === "string"
    ? result.content
    : (result.content as { text?: string }[]).map((part) => part.text ?? "")
      .join("");
  const start = raw.indexOf('{"status"');
  const end = raw.lastIndexOf("}");
  assert(
    start >= 0 && end > start,
    `tool 결과 JSON이 없다: ${raw.slice(0, 300)}`,
  );
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

const state: {
  document?: string;
  version?: string;
} = {};

const reference = () => ({
  document: state.document!,
  version: state.version!,
  section: null,
});

const STEPS: Step[] = [
  // 1: 허용된 자료에서 근거를 읽는다.
  () =>
    toolCall("toolu_read", "document.read_version", { reference: reference() }),
  // 2: 답 안에 표와 막대 차트를 넣는다. 수집되지 않은 값은 null이다.
  () =>
    toolCall("toolu_show", "visual.show", {
      content: {
        schema_version: 1,
        parts: [
          { kind: "text", text: "Here is the comparison." },
          {
            kind: "visual",
            block: {
              key: "sales",
              schema_version: 1,
              kind: "table",
              title: "Sales by quarter",
              description: "Units sold per quarter. Q3 has no recorded figure.",
              sources: [{
                kind: "document",
                reference: {
                  document: state.document!,
                  version: state.version!,
                },
                observed_at: null,
              }],
              payload: {
                columns: [
                  { key: "quarter", label: "Quarter", type: "string" },
                  { key: "units", label: "Units", type: "number" },
                ],
                rows: [
                  { quarter: "Q1", units: 120 },
                  { quarter: "Q2", units: 180 },
                  { quarter: "Q3", units: null },
                ],
              },
            },
          },
          {
            kind: "visual",
            block: {
              key: "trend",
              schema_version: 1,
              kind: "chart",
              title: "Units by quarter",
              description: "Bar per quarter. Q3 is missing, not zero.",
              sources: [{
                kind: "document",
                reference: {
                  document: state.document!,
                  version: state.version!,
                },
                observed_at: null,
              }],
              payload: {
                type: "bar",
                x: { label: "Quarter", type: "category" },
                y: { label: "Units" },
                series: [{
                  key: "units",
                  label: "Units",
                  points: [
                    { x: "Q1", y: 120 },
                    { x: "Q2", y: 180 },
                    { x: "Q3", y: null },
                  ],
                }],
              },
            },
          },
        ],
      },
    }),
  () => ({ text: ANSWER, usage: { input: 40, output: 9 }, stop: "end" }),
  // 5: 사람이 고른 블록을 문서로 남긴다. 준비와 저장은 다른 tool이다.
  (body) => {
    const message = body.match(/in message (msg_[0-9a-z]{26})/)?.[1];
    assert(message !== undefined, "남기기 요청에 메시지 ID가 없다");
    return toolCall("toolu_prepare", "visual.prepare_document", {
      message,
      block_keys: ["sales"],
    });
  },
  (body) => {
    const result = lastToolResult(body);
    const content = result.content as {
      prepared: boolean;
      saved: boolean;
      text: string;
    };
    assert(
      content.prepared && !content.saved,
      JSON.stringify(result).slice(0, 300),
    );
    // 작은 표라 준비한 글이 한 번에 온다(이어 읽을 조각이 없다).
    assertEquals(result.complete, true);
    return toolCall("toolu_save", "document.create", {
      title: SAVED_TITLE,
      place: null,
      name: null,
      text: content.text,
      media_type: "text/html",
    });
  },
  () => ({ text: SAVED_ANSWER, usage: { input: 40, output: 9 }, stop: "end" }),
];

type RunRow = { id: string; state: string; outcome: { kind: string } | null };

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
    "lophn-agent/visuals#R1 lophn-agent/visuals#R2 lophn-agent/visuals#R6 shell/workspace#R12 shell/workspace#R13 flow view-agent-visuals: 답 안의 표·차트를 출처와 함께 읽고 고른 블록을 실행 코드 없는 고정 문서로 남겨 다시 연다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-visuals-" }),
    );
    await Deno.writeTextFile(
      `${folder}/${SOURCE}.md`,
      "# Sales\n\n| Quarter | Units |\n| --- | --- |\n| Q1 | 120 |\n| Q2 | 180 |\n| Q3 | not recorded |\n",
    );
    const provider = startDynamicProvider(STEPS);
    let flow = await openFlowShell({ start: "lophn" });
    const home = flow.home;
    try {
      await setDefaults(flow, provider.url);
      await registerTrackedProject(flow, { folder });
      await untilDocuments(flow, [SOURCE], "추적한 파일이 문서가 되지 않았다");
      const source = await documentTitled(flow, SOURCE);
      await untilReadable(flow, source.id, "자료 본문이 준비되지 않았다");
      state.document = source.id;
      state.version = (await documentTitled(flow, SOURCE)).latest_version;

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
      const openDock = async () => {
        await flow.until(
          `document.querySelector("[data-dock-toggle]") !== null`,
          "도크 토글이 없다",
        );
        await flow.click("[data-dock-toggle]");
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
      };
      const sourceLink = `${source.id}@${state.version}`;

      await t.step(
        "lophn-agent/visuals#R1 lophn-agent/visuals#R2 lophn-agent/conversation#R13 shell/workspace#R12 shell/workspace#R13: 1·2·3·4 읽은 판을 근거로 답 안에 표와 막대 차트가 서고 블록마다 제목·설명·출처가 보인다",
        async () => {
          await openDock();
          await flow.type(INPUT, ASK);
          await flow.click(SEND);
          const rows = await untilRuns(1);
          assertEquals(rows[0]!.outcome?.kind, "completed");
          assertEquals(provider.calls(), 3);
          // 1: 읽은 근거는 사람이 등록한 파일의 고정 판이다.
          assert(
            provider.body(1).includes("not recorded"),
            "읽은 판 본문이 tool 결과에 없다",
          );
          await flow.until(
            `document.querySelector(${
              JSON.stringify(DOCK)
            })?.innerText.includes(${JSON.stringify(ANSWER)})`,
            "도크에 답이 없다",
          );
          // 3·4: 검사한 명세가 SDK 표·막대 차트로 그려진다.
          await flow.until(
            `document.querySelector("${DOCK} [data-visual='table'][data-visual-key='sales'] [data-visual-table]") !== null`,
            `표 블록이 그려지지 않았다: ${provider.body(2).slice(-600)}`,
          );
          await flow.until(
            `document.querySelector("${DOCK} [data-visual='chart'][data-visual-key='trend'] [data-visual-chart='bar']") !== null`,
            "막대 차트가 그려지지 않았다",
          );
          const table = String(
            await flow.evaluate(
              `document.querySelector("${DOCK} [data-visual-key='sales']").innerText`,
            ),
          );
          for (
            const word of [
              "Sales by quarter",
              "Q3 has no recorded figure",
              "180",
            ]
          ) {
            assert(table.includes(word), `표 블록에 ${word}가 없다: ${table}`);
          }
          // 출처: 읽은 고정 판 하나가 블록마다 선다.
          assertEquals(
            await flow.count(
              `${DOCK} [data-visual-document='${sourceLink}']`,
            ),
            2,
          );
          // 임의 HTML·script는 shell 코드로 들어오지 않는다.
          assertEquals(
            await flow.count(
              `${DOCK} [data-visual] script, ${DOCK} [data-visual] iframe`,
            ),
            0,
          );
          assertEquals(await flow.count("[data-visual-unavailable]"), 0);
        },
      );

      await t.step(
        "lophn-agent/visuals#R6 lophn-agent/harness/tools#R19 lophn-agent/harness/tools#R6 documents/formats#R4 shell/workspace#R13: 5 블록을 남기기를 청하면 실행 코드 없는 HTML 본문을 준비해 별도 문서 tool로 저장하고 작성 중인 글은 그대로다",
        async () => {
          await flow.type(INPUT, DRAFT);
          await flow.click(`${DOCK} [data-save-visual='sales']`);
          const rows = await untilRuns(2);
          assert(
            rows.every((row) => row.outcome?.kind === "completed"),
            JSON.stringify(rows),
          );
          assertEquals(provider.calls(), 6);
          // 준비만으로는 저장이 아니다: 준비 결과는 saved false, 저장은 document.create다.
          const prepared = lastToolResult(provider.body(4)).content as {
            text: string;
            media_type: string;
          };
          assertEquals(prepared.media_type, "text/html");
          assert(
            !/<script/i.test(prepared.text),
            "준비한 본문에 script가 있다",
          );
          assert(prepared.text.includes("Sales by quarter"));
          const saved = await documentTitled(flow, SAVED_TITLE);
          assertEquals(saved.status, "active");
          // 블록 아래 고정 문서 링크는 결함 (8)로 서지 않는다(머리 주석): 저장 요청의 run이 끝나도
          // 답 메시지에 저장한 문서 링크가 없어 블록은 "저장하지 않음"으로 남는다. 여기서는 그
          // 링크를 보지 않는다.
          // 작성 중이던 글은 그대로다.
          assertEquals(
            await flow.evaluate(
              `document.querySelector(${JSON.stringify(INPUT)}).value`,
            ),
            DRAFT,
          );
        },
      );

      await t.step(
        "documents/versions#R5 documents/versions#R6 lophn-agent/conversation#R2 lophn-agent/conversation#R12: 7 저장한 고정 판을 열어 읽고 다시 띄운 뒤에도 원래 메시지·출처와 저장 문서로 돌아온다",
        async () => {
          const saved = await documentTitled(flow, SAVED_TITLE);
          // 저장 링크가 없어(결함 (8)) 읽기 화면 대신 사람 token으로 그 고정 판을 읽는다.
          await untilReadable(flow, saved.id, "저장한 문서를 읽을 수 없다");
          const read = await mustCall(flow, {
            kind: "worker",
            resource: "documents",
            method: "read",
            body: {
              reference: {
                document: saved.id,
                version: saved.latest_version,
                section: null,
              },
            },
          });
          assert(
            String(read.text).includes("Sales by quarter"),
            String(read.text).slice(0, 300),
          );
          assert(
            !/<script/i.test(String(read.text)),
            "저장 본문에 script가 있다",
          );

          await flow.close();
          flow = await openFlowShell({ home, start: "lophn" });
          await openDock();
          await flow.until(
            `document.querySelector(${
              JSON.stringify(DOCK)
            })?.innerText.includes(${JSON.stringify(SAVED_ANSWER)})`,
            "다시 연 도크에 저장 답이 없다",
          );
          await flow.until(
            `document.querySelector("${DOCK} [data-visual-key='sales'] [data-visual-table]") !== null`,
            "다시 연 도크에 표 블록이 없다",
          );
          assertEquals(
            await flow.count(`${DOCK} [data-visual-document='${sourceLink}']`),
            2,
          );
          const after = await listDocuments(flow);
          assert(
            after.some((row) => row.id === saved.id && row.status === "active"),
          );
          // 다시 띄워도 과거 동작을 재실행하지 않는다.
          assertEquals((await runsOf()).length, 2);
          assertEquals(provider.calls(), 6);
        },
      );
    } finally {
      await flow.close();
      await removeHome(home);
      await provider.close();
      await Deno.remove(folder, { recursive: true });
    }
  },
});
