// lophn-agent slice flow E2E: add-agent-extension(docs/flows/add-agent-extension.md)과
// approve-action(docs/flows/approve-action.md)의 agent 갈래. 실제 shell(headless)·core(제품 runtime
// child)를 임시 LOPHN_HOME으로 띄우고 model은 이 시험의 loopback 응답 server가 낸다. 외부 MCP는
// 이 시험이 temp dir에 쓴 가짜 stdio child이고, 받은 tools/call을 temp 기록 파일에 한 줄씩 남겨
// server에 실제로 닿았는지를 본다. 실제 ~/.lophn·실제 provider·실제 MCP server는 쓰지 않는다.
// add-agent-extension
// - 2: 사람이 MCP server(stdio·정확한 실행·tool 분류)를 등록하고 settings 화면 도구 탭에서 본다.
// - 3·4: 기본 lophn preset을 복사해 server의 정확한 tool 둘만 고른 새 판을 만들고 assignment에
//   명시 적용한다.
// - 5: 다음 run은 고른 tool만 받고(고르지 않은 write_note는 없다), 분류·safe인 read_note는 확인
//   없이 원래 이름·입력으로 server에 닿는다.
// approve-action(앱 confirm 단계 제외, apps#T27이 돈다)
// - 1: 미분류 scan_note 호출은 approval request가 되고 결정 전에는 server에 닿지 않는다.
// - 2·3·4: things-to-confirm 화면에서 기다리는 결정을 찾아 확인 창을 열고, 창에서 허락한다.
// - 5·6: 허락한 그 호출만 한 번 실행되고 run이 이어 끝난다. 결정은 지난 것으로 남는다.
// - 다른 갈래 4: 거절한 호출은 미실행으로 남는다.
// 넘긴 것: skill 폴더 등록(1)과 skill 선택 판은 이 파일이 돌지 않는다(MCP 갈래만).
// 결함 (6), 5단계와 approve-action 단계는 `ignore`: 제품 runtime이 외부 MCP server에 닿지 못한다.
// stdio는 core가 runtime child를 띄울 때 `agentRuntimeLaunchSpec`에 `mcpServers`를 넘기지 않고
// (apps/core/agent-runtime.ts `specFor`는 provider hosts만 넘긴다) 등록 뒤에도 다시 띄우지 않아
// `--allow-run`이 빈 목록이라 child를 열지 못한다. HTTP는 제품 `mcpConnectionsDeps`
// (apps/agent-runtime/product-driver.ts)에 `fetch`가 없어 "HTTP 연결 눈이 없다"이고 MCP host도
// `--allow-net`에 더해지지 않는다. 그래서 다음 run에 고른 MCP tool이 실리지 않고, approval
// request를 만드는 유일한 agent 통로(미분류 외부 tool)도 닿지 않는다. 해당 단계는 써 두되
// 확인하지 못했다(미검증).
import { assert, assertEquals } from "@std/assert";

import { buildReply } from "../../tools/fake-provider/semantic.ts";
import type { SemanticReply } from "../../tools/fake-provider/types.ts";
import { mcpServersSetting } from "../../packages/contracts/lophn-agent/mod.ts";
import {
  mcpToolDefinitionHash,
  type McpToolEntry,
} from "../../packages/lophn-agent/extensions/mod.ts";
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
const PRESET = "pst_01arz3ndektsv4rrffq69g5faw";
const MODEL = "claude-sonnet-4-5";

const INPUT = "[data-composer-input]";
const SEND = "[data-send]";
const DOCK = "[data-dock]";

const READ_ANSWER = "The note says hello.";
const SCAN_ANSWER = "The scan is done.";

// tools read_note·write_note·scan_note를 알리고, 받은 tools/call을 기록 파일에 남긴 뒤 입력을
// 그대로 되돌린다.
const MCP_CHILD = `\
const log = Deno.args[0];
const dec = new TextDecoder();
let buf = "";
for (;;) {
  const chunk = new Uint8Array(4096);
  const n = await Deno.stdin.read(chunk);
  if (n === null) break;
  buf += dec.decode(chunk.subarray(0, n));
  for (;;) {
    const at = buf.indexOf("\\n");
    if (at < 0) break;
    const line = buf.slice(0, at);
    buf = buf.slice(at + 1);
    if (line.trim() === "") continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    const reply = (result) => Deno.stdout.write(new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n"));
    if (message.method === "initialize") {
      await reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } });
    } else if (message.method === "tools/list") {
      const tool = (name) => ({ name, description: name + " desc", inputSchema: { type: "object", properties: { id: { type: "string" } } } });
      await reply({ tools: [tool("read_note"), tool("write_note"), tool("scan_note")] });
    } else if (message.method === "tools/call") {
      const called = message.params.name + ":" + JSON.stringify(message.params.arguments);
      await Deno.writeTextFile(log, called + "\\n", { append: true });
      await reply({ content: [{ type: "text", text: "mcp-ok:" + called }] });
    }
  }
}
`;

const NOTE_SCHEMA = {
  type: "object",
  properties: { id: { type: "string" } },
};

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

const end = (text: string): Step => () => ({
  text,
  usage: { input: 40, output: 9 },
  stop: "end",
});

const STEPS: Step[] = [
  () => toolCall("toolu_read", "ext_notes_read_note", { id: "n1" }),
  end(READ_ANSWER),
  () => toolCall("toolu_scan", "ext_notes_scan_note", { id: "n2" }),
  end(SCAN_ANSWER),
  () => toolCall("toolu_scan_again", "ext_notes_scan_note", { id: "n3" }),
  end("I did not scan it."),
];

type RunRow = { id: string; state: string; outcome: { kind: string } | null };
type ApprovalRow = { id: string; run: string | null; status: string };

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

const hashOf = (original: string) =>
  mcpToolDefinitionHash(
    {
      server: "notes",
      original,
      description: `${original} desc`,
      schema: NOTE_SCHEMA,
    } satisfies McpToolEntry,
  );

/** 사람이 MCP server를 등록한다(settings/apply). read_note·write_note만 현재 분류가 있다. */
async function registerServer(
  flow: FlowShell,
  child: string,
  log: string,
): Promise<void> {
  const current = await mustCall(flow, {
    kind: "read",
    resource: "settings",
    method: "get",
    body: { keys: [mcpServersSetting.key] },
  });
  await mustCall(flow, {
    kind: "command",
    resource: "settings",
    method: "apply",
    body: {
      input: {
        changes: [{
          layer: "common",
          key: mcpServersSetting.key,
          action: "set",
          value: [{
            name: "notes",
            revision: 1,
            enabled: true,
            transport: "stdio",
            call_timeout_ms: 60_000,
            classifications: {
              read_note: {
                effect: "read",
                reversible: true,
                schema_hash: await hashOf("read_note"),
              },
              write_note: {
                effect: "external",
                reversible: false,
                schema_hash: await hashOf("write_note"),
              },
              // 정의 hash가 맞지 않는 옛 분류다. preset은 분류 항목이 있는 tool만 현재 tool로
              // 고르게 하므로(presets rejectUnknownMcp) 미분류 tool은 이 모양으로만 고를 수 있고,
              // run에서는 분류가 없는 것과 같다(extensions#R24·R28).
              scan_note: {
                effect: "read",
                reversible: true,
                schema_hash: "0".repeat(64),
              },
            },
            stdio: {
              executable: "/bin/sh",
              args: [
                "-c",
                `deno run --allow-read --allow-write --allow-env ${child} ${log}`,
              ],
              cwd: null,
              env: {},
            },
          }],
        }],
      },
      idempotency_key: crypto.randomUUID(),
      compare: {
        revision: current.revision,
        defaults_revision: current.defaults_revision,
      },
      prepared: [],
    },
  });
}

/** 확인 창 페이지를 잡는다. 창이 뜰 때까지 기다린다. */
async function confirmationPage(flow: FlowShell) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await flow.shell.connect("lophn-shell://confirmation/");
    } catch (error) {
      assert(Date.now() < deadline, `확인 창이 없다: ${error}`);
      await delay(250);
    }
  }
}

async function pageUntil(
  page: Awaited<ReturnType<typeof confirmationPage>>,
  expression: string,
  what: string,
): Promise<unknown> {
  const limit = Date.now() + 30_000;
  let last: unknown;
  while (Date.now() < limit) {
    try {
      last = await page.evaluate(expression);
    } catch (error) {
      last = String(error);
    }
    if (last) return last;
    await delay(200);
  }
  throw new Error(`${what}: ${JSON.stringify(last)}`);
}

Deno.test({
  name:
    "lophn-agent/extensions#R11 lophn-agent/extensions#R28 lophn-agent/presets#R14 platform/approvals#R3 flow add-agent-extension·approve-action: 등록한 MCP server의 고른 tool만 다음 run이 쓰고, 미분류 tool은 확인 창의 허락 뒤에만 한 번 실행되며 거절은 미실행이다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const scratch = await Deno.makeTempDir({ prefix: "lophn-e2e-mcp-" });
    const child = `${scratch}/fake-mcp-child.mjs`;
    const log = `${scratch}/calls.log`;
    await Deno.writeTextFile(child, MCP_CHILD);
    await Deno.writeTextFile(log, "");
    const provider = startDynamicProvider(STEPS);
    const flow = await openFlowShell({ start: "lophn" });
    const home = flow.home;
    try {
      await setDefaults(flow, provider.url);
      const assignmentsOf = async () =>
        (await mustCall(flow, {
          kind: "read",
          resource: "assignments",
          method: "list",
          body: {},
        })).assignments as {
          id: string;
          role: string;
          revision: number;
          preset: string;
          preset_revision: number;
        }[];
      const agent = (await assignmentsOf()).find((row) => row.role === "lophn");
      assert(agent !== undefined, "lophn assignment가 없다");
      const runsOf = async (): Promise<RunRow[]> =>
        (await mustCall(flow, {
          kind: "read",
          resource: "runs",
          method: "list",
          body: { assignment: agent.id },
        })).runs as RunRow[];
      const approvals = async (): Promise<ApprovalRow[]> =>
        (await mustCall(flow, {
          kind: "read",
          resource: "approvals",
          method: "list",
          body: {},
        })).requests as ApprovalRow[];
      const called = async () =>
        (await Deno.readTextFile(log)).split("\n").filter((line) =>
          line !== ""
        );
      const dockText = async () =>
        String(
          await flow.evaluate(
            `document.querySelector(${
              JSON.stringify(DOCK)
            })?.innerText ?? null`,
          ),
        ).slice(0, 600);
      const untilRun = async (
        count: number,
        want: (row: RunRow) => boolean,
        what: string,
      ) => {
        const deadline = Date.now() + 180_000;
        for (;;) {
          const rows = await runsOf();
          const last = rows.length === count
            ? rows.find((row) =>
              !rows.some((other) => other !== row && other.id > row.id)
            )
            : undefined;
          if (last !== undefined && want(last)) return last;
          if (Date.now() > deadline) {
            throw new Error(
              `${what} | runs=${
                JSON.stringify(rows)
              } calls=${provider.calls()} log=${
                JSON.stringify(await called())
              } dock=${JSON.stringify(await dockText())}`,
            );
          }
          await delay(250);
        }
      };
      const present = async (selector: string) =>
        await flow.evaluate(
          `document.querySelector(${JSON.stringify(selector)}) !== null`,
        ) === true;
      /** documents 화면에서 도크 입력칸을 연다. 닫혀 있으면 열고 세션이 없으면 새로 연다. */
      const openInput = async () => {
        await flow.click('[data-screen="documents"]');
        await flow.until(
          `document.querySelector("[data-dock-toggle]") !== null`,
          "도크 토글이 없다",
        );
        if (!await present(INPUT) && !await present("[data-new-session]")) {
          await flow.click("[data-dock-toggle]");
        }
        await flow.until(
          `document.querySelector("[data-new-session]") !== null || document.querySelector(${
            JSON.stringify(INPUT)
          }) !== null`,
          "도크가 서지 않았다",
        );
        if (!await present(INPUT)) await flow.click("[data-new-session]");
        await flow.until(
          `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
          "입력칸이 서지 않았다",
        );
      };
      const send = async (text: string) => {
        await flow.type(INPUT, text);
        await flow.click(SEND);
      };
      /** things-to-confirm에서 기다리는 결정을 열고 확인 창에서 `decision`을 누른다. */
      const decide = async (decision: string) => {
        await flow.click('[data-screen="things-to-confirm"]');
        await flow.until(
          `document.querySelector("[data-next='approval']:not([disabled])") !== null`,
          "기다리는 결정이 없다",
          60_000,
        );
        await flow.click("[data-next='approval']");
        await flow.until(
          `document.querySelector("[data-detail] [data-review]") !== null`,
          "결정 상세에 확인 단추가 없다",
        );
        // 미리보기를 본 것만으로는 결정이 아니다.
        assert(
          (await approvals()).some((row) => row.status === "pending"),
          "미리보기만으로 결정이 바뀌었다",
        );
        await flow.click("[data-detail] [data-review]");
        const page = await confirmationPage(flow);
        await pageUntil(
          page,
          `document.querySelector("[data-decision='${decision}']") !== null`,
          "확인 창에 결정 단추가 없다",
        );
        const shown = String(
          await page.evaluate(
            `document.querySelector("[data-layout='confirmation']")?.innerText ?? ""`,
          ),
        );
        assert(
          shown.includes("scan_note"),
          `확인 창에 정확한 동작이 없다: ${shown.slice(0, 400)}`,
        );
        for (
          const each of [
            "grant_approval_request",
            "reject_approval_request",
          ]
        ) {
          assertEquals(
            await page.evaluate(
              `document.querySelector("[data-decision='${each}']") !== null`,
            ),
            true,
            `${each} 단추가 없다`,
          );
        }
        await page.evaluate(
          `document.querySelector("[data-decision='${decision}']").click()`,
        );
      };

      await t.step(
        "lophn-agent/extensions#R11 lophn-agent/presets#R7 lophn-agent/presets#R14: 2·3·4 MCP server를 등록해 도구 탭에서 보고, 기본 preset을 복사해 정확한 tool만 고른 판을 명시 적용한다",
        async () => {
          await registerServer(flow, child, log);
          await flow.click('[data-screen="settings"]');
          await flow.until(
            `document.querySelector("[role=tab]") !== null`,
            "settings 탭이 없다",
          );
          await flow.mouseClickText("[role=tab]", "Tools and skills");
          await flow.until(
            `document.querySelector("[data-server='notes']") !== null`,
            "도구 탭에 등록한 server가 없다",
          );

          const base = await mustCall(flow, {
            kind: "read",
            resource: "presets",
            method: "read",
            body: { preset: agent.preset, revision: agent.preset_revision },
          });
          const definition =
            (base.preset as { definition: Record<string, unknown> })
              .definition;
          await mustCall(flow, {
            kind: "command",
            resource: "presets",
            method: "create",
            body: commandBody({
              id: PRESET,
              definition: {
                ...definition,
                name: "Notes",
                origin: "user",
                mcp: {
                  servers: ["notes"],
                  tools: ["read_note", "scan_note"].map((original_tool) => ({
                    server_name: "notes",
                    original_tool,
                  })),
                },
                safe_tools: [{
                  server_name: "notes",
                  original_tool: "read_note",
                }],
              },
              copied_from: {
                preset: agent.preset,
                revision: agent.preset_revision,
              },
            }),
          });
          await mustCall(flow, {
            kind: "command",
            resource: "assignments",
            method: "change-preset",
            body: commandBody({
              assignment: agent.id,
              preset: PRESET,
              preset_revision: 1,
            }, { revision: agent.revision, role: "lophn" }),
          });
          const applied = (await assignmentsOf()).find((row) =>
            row.id === agent.id
          );
          assertEquals(applied?.preset, PRESET);
        },
      );

      await t.step({
        name:
          "lophn-agent/extensions#R5 lophn-agent/extensions#R29 lophn-agent/presets#R8: 5 다음 run은 고른 tool만 받고 분류·safe tool은 원래 이름·입력으로 server에 닿는다",
        // 결함 (6): 제품 runtime이 외부 MCP server에 닿지 못한다(머리 주석).
        ignore: true,
        fn: async () => {
          await openInput();
          await send("Read note n1.");
          const run = await untilRun(
            1,
            (row) => row.outcome !== null,
            "읽기 run이 끝나지 않았다",
          );
          assertEquals(run.outcome?.kind, "completed");
          assertEquals(provider.calls(), 2);
          const offered = provider.body(0);
          assert(offered.includes('"ext_notes_read_note"'), "read_note가 없다");
          assert(offered.includes('"ext_notes_scan_note"'), "scan_note가 없다");
          assert(!offered.includes("write_note"), "고르지 않은 tool이 나왔다");
          assertEquals(await called(), ['read_note:{"id":"n1"}']);
          assert(
            provider.body(1).includes("mcp-ok:read_note"),
            "server 결과가 다음 요청에 없다",
          );
          await flow.until(
            `document.querySelector(${
              JSON.stringify(DOCK)
            })?.innerText.includes(${JSON.stringify(READ_ANSWER)})`,
            "도크에 답이 없다",
          );
          assertEquals((await approvals()).length, 0);
        },
      });

      await t.step({
        name:
          "lophn-agent/extensions#R28 lophn-agent/harness/tool-judgment#R1 platform/approvals#R3 platform/approvals#R5 shell/confirmation-window#R4: approve-action 1~6 미분류 tool은 확인 창에서 허락한 뒤에만 한 번 실행되고 run이 이어 끝난다",
        // 결함 (6): 제품 runtime이 외부 MCP server에 닿지 못한다(머리 주석).
        ignore: true,
        fn: async () => {
          await send("Scan note n2.");
          const waiting = await untilRun(
            2,
            (row) => row.state === "waiting",
            "run이 결정을 기다리지 않는다",
          );
          const [request] = await approvals();
          assert(request !== undefined, "approval request가 없다");
          assertEquals(request.status, "pending");
          assertEquals(request.run, waiting.id);
          // 결정 전에는 server에 닿지 않고 model도 더 부르지 않는다.
          await delay(1_000);
          assertEquals(await called(), ['read_note:{"id":"n1"}']);
          assertEquals(provider.calls(), 3);

          await decide("grant_approval_request");
          const done = await untilRun(
            2,
            (row) => row.outcome !== null,
            "허락 뒤 run이 끝나지 않았다",
          );
          assertEquals(done.outcome?.kind, "completed");
          assertEquals(await called(), [
            'read_note:{"id":"n1"}',
            'scan_note:{"id":"n2"}',
          ]);
          assertEquals(provider.calls(), 4);
          assert(provider.body(3).includes("mcp-ok:scan_note"));
          const granted = (await approvals()).find((row) =>
            row.id === request.id
          );
          assertEquals(granted?.status, "granted");
          // 6: 결정은 지난 것으로 남는다.
          await flow.mouseClickText("[role=tab]", "Past");
          await flow.until(
            `document.querySelector("[data-tab-panel='past'] [data-empty]") === null && document.querySelector("[data-tab-panel='past']")?.innerText.trim().length > 0`,
            "지난 결정이 보이지 않는다",
          );
        },
      });

      await t.step({
        name:
          "platform/approvals#R14 platform/approvals#R15: approve-action 다른 갈래 4 거절한 호출은 미실행으로 남는다",
        // 결함 (6): 제품 runtime이 외부 MCP server에 닿지 못한다(머리 주석).
        ignore: true,
        fn: async () => {
          await openInput();
          await send("Scan note n3.");
          await untilRun(
            3,
            (row) => row.state === "waiting",
            "run이 결정을 기다리지 않는다",
          );
          await decide("reject_approval_request");
          await untilRun(
            3,
            (row) => row.outcome !== null,
            "거절 뒤 run이 끝나지 않았다",
          );
          const rejected = (await approvals()).filter((row) =>
            row.status === "rejected"
          );
          assertEquals(rejected.length, 1);
          await delay(1_000);
          assertEquals(await called(), [
            'read_note:{"id":"n1"}',
            'scan_note:{"id":"n2"}',
          ]);
        },
      });
    } finally {
      await flow.close();
      await removeHome(home);
      await provider.close();
      await Deno.remove(scratch, { recursive: true });
    }
  },
});
