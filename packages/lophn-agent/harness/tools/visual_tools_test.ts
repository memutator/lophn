import { assert, assertEquals, assertFalse } from "@std/assert";
import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import {
  app,
  at,
  chartBlock,
  doc,
  msg,
  rel,
  run,
  ses,
  tableBlock,
  tcl,
  ver,
} from "../../visuals/testing/mod.ts";
import { ROUTES } from "../../../contracts/lophn-agent/mod.ts";
import { ROLE_CAPS } from "../../presets/mod.ts";
import {
  BUILTIN_TOOLS,
  createBuiltinToolHandlers,
  createVisualToolHandlers,
  executeTool,
  listTools,
  type RunCredential,
  runOperations,
  TOOL_BUNDLES,
  VISUAL_TOOL_NAMES,
  VISUAL_TOOLS,
} from "./mod.ts";
import { createReadLog } from "./bundles/read-log.ts";

// 시각 묶음(visual.show·visual.read·visual.prepare_document)의 정의와 handler. 소유 contract는
// 메모리 fake로 흉내 내고 실제 core를 거친 확인은 apps/core/visual-tools_test.ts가 한다. model
// provider는 부르지 않는다.

const RUN = run;
const CALL = tcl;
const NEXT_MESSAGE = "msg_01arz3ndektsv4rrffq69g5fax";

type Call = { contract: string; input: Record<string, unknown>; run: string };
type Stored = { id: string; content: unknown; links: unknown };

const card = {
  key: "card",
  schema_version: 1,
  kind: "app_card",
  title: "Orders card",
  description: "the live orders screen",
  sources: [],
  payload: { app, release: rel, view: "summary", input: {} },
};

// 출처 검사를 따로 보지 않는 시험은 출처 없는 블록을 쓴다.
const table0 = { ...tableBlock, sources: [] };
const chart0 = { ...chartBlock, sources: [] };

function content(...blocks: unknown[]) {
  return {
    schema_version: 1,
    parts: [
      { kind: "text", text: "here" },
      ...blocks.map((block) => ({ kind: "visual", block })),
      { kind: "text", text: "that is all" },
    ],
  };
}

function world(
  options: {
    session?: string | null;
    toolCall?: unknown;
    toolCallError?: "not_found" | "unavailable";
    documentText?: string;
  } = {},
) {
  const calls: Call[] = [];
  const messages = new Map<string, Stored>();
  const session = options.session === undefined ? ses : options.session;
  const ports = {
    calls,
    messages,
    call(
      contract: string,
      input: unknown,
      run: string,
    ): Promise<Result<unknown>> {
      const given = input as Record<string, unknown>;
      calls.push({ contract, input: given, run });
      if (contract === "RecordMessage") {
        const id = String(given["id"]);
        const stored = messages.get(id);
        const same = stored !== undefined &&
          canonicalize(stored.content) === canonicalize(given["content"]);
        if (stored !== undefined && !same) {
          return Promise.resolve(
            err({ code: "conflict", message: "message id already used" }),
          );
        }
        messages.set(id, {
          id,
          content: given["content"],
          links: given["links"],
        });
        return Promise.resolve(ok({ message: { id }, created_seq: "1" }));
      }
      if (contract === "ReadMessageBody") {
        const stored = messages.get(String(given["message"]));
        return Promise.resolve(
          stored === undefined
            ? err({ code: "not_found", message: "no such message" })
            : ok({
              message: stored.id,
              session: ses,
              body: "cd".repeat(32),
              size_bytes: 1,
              content: stored.content,
            }),
        );
      }
      if (contract === "ReadToolCall") {
        return Promise.resolve(
          options.toolCallError !== undefined
            ? err({ code: options.toolCallError, message: "no" })
            : ok({ tool_call: options.toolCall }),
        );
      }
      if (contract === "document.read") {
        return Promise.resolve(ok({
          document: doc,
          version: ver,
          text: options.documentText ?? "the numbers",
          ranges: [],
        }));
      }
      return Promise.resolve(
        err({ code: "internal", message: `unexpected ${contract}` }),
      );
    },
    newId: () => NEXT_MESSAGE,
    runFacts: () =>
      Promise.resolve(
        ok({ session, role: "lophn" as const, original_message: msg }),
      ),
  };
  return ports;
}

// 이미 확정된 메시지를 읽기 쪽에 둔다(기록 경로를 거치지 않는다).
function seed(
  ports: ReturnType<typeof world>,
  value: unknown,
  id = "msg_01arz3ndektsv4rrffq69g5fam",
): string {
  ports.messages.set(id, { id, content: value, links: [] });
  return id;
}

function credential(call: string | null = CALL): RunCredential {
  return {
    run: RUN,
    targets: new Set(),
    operations: new Set(BUILTIN_TOOLS.map((tool) => tool.contract)),
    ...(call === null ? {} : { call }),
  };
}

function rig(options: Parameters<typeof world>[0] = {}) {
  const ports = world(options);
  const listed = listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    {
      presetTools: BUILTIN_TOOLS.map((tool) => tool.name),
      roleTools: BUILTIN_TOOLS.map((tool) => tool.name),
    },
  );
  const handlers = createBuiltinToolHandlers(ports);
  return {
    ports,
    run: (tool: string, input: unknown, call?: string | null) =>
      executeTool(
        { listed, handlers, credential: credential(call) },
        tool,
        input,
      ),
  };
}

function contentOf(outcome: { result: { content: unknown } }) {
  return outcome.result.content as Record<string, unknown>;
}

Deno.test("lophn-agent/harness/tools#R19: 시각 tool은 셋이고 각각 소유 contract 하나를 가리키며 문서 저장 tool이 아니고 묶음과 역할 상한에 이름이 있다", () => {
  assertEquals(
    VISUAL_TOOLS.map((tool) => [tool.name, tool.effect, tool.contract]),
    [
      ["visual.show", "write", "RecordMessage"],
      ["visual.read", "read", "ReadMessageBody"],
      ["visual.prepare_document", "read", "ReadMessageBody"],
    ],
  );
  const owned = new Set<string>(ROUTES.map((route) => route.name));
  for (const tool of VISUAL_TOOLS) {
    assert(owned.has(tool.contract), `${tool.name} → ${tool.contract}`);
    assertEquals(tool.confirm, false, tool.name);
    assertEquals(
      BUILTIN_TOOLS.filter((one) => one.name === tool.name).length,
      1,
    );
  }
  assertEquals(TOOL_BUNDLES.get("visual"), VISUAL_TOOL_NAMES);
  // 문서 저장은 기존 문서 tool 몫이다: 시각 묶음에 저장·생성 동작은 없다.
  for (const name of VISUAL_TOOL_NAMES) {
    assertFalse(
      /save|create|document\.(?!prepare)/.test(
        name.replace("visual.prepare_document", ""),
      ),
      name,
    );
  }
  assertEquals(
    runOperations(VISUAL_TOOLS.filter((tool) => tool.name === "visual.read")),
    ["ReadMessageBody"],
  );
  // 세 tool은 lophn·앱 담당·context 담당과 승인 목록의 operator가 고를 수 있다.
  for (const role of ["lophn", "app_engineer", "context_engineer"] as const) {
    const names = ROLE_CAPS.get(role)!.tools;
    for (const name of VISUAL_TOOL_NAMES) {
      assert(names.includes(name), `${role} ${name}`);
    }
  }
});

Deno.test("lophn-agent/harness/tools#R19: visual.show는 글과 블록을 순서대로 RecordMessage 한 번으로 기록하고 hash·blob·본문 참조를 만들지 않으며 같은 호출의 재전송은 메시지를 늘리지 않는다", async () => {
  const { ports, run } = rig();
  const input = { content: content(table0, chart0) };
  const shown = await run("visual.show", input);
  assertEquals(shown.outcome, { kind: "success", code: "ok" });
  assertEquals(contentOf(shown), {
    message: "msg_01arz3ndektsv4rrffq69g5fav",
    stored: true,
    blocks: [{ key: "counts", kind: "table" }, { key: "trend", kind: "chart" }],
  });
  const sent = ports.calls.filter((call) => call.contract === "RecordMessage");
  assertEquals(sent.length, 1);
  // 입력은 값뿐이다: 본문 hash·blob·준비 참조 자리가 없다. 고른 run의 자격으로 부른다.
  assertEquals(Object.keys(sent[0]!.input).sort(), [
    "content",
    "id",
    "links",
    "run",
    "session",
  ]);
  assertEquals(sent[0]!.run, RUN);
  assertEquals(sent[0]!.input["run"], RUN);
  assertEquals(sent[0]!.input["session"], ses);
  const parts = (sent[0]!.input["content"] as { parts: { kind: string }[] })
    .parts;
  assertEquals(parts.map((part) => part.kind), [
    "text",
    "visual",
    "visual",
    "text",
  ]);
  // 문서 출처는 같은 메시지의 version 링크가 된다.
  assertEquals(sent[0]!.input["links"], []);
  assertEquals(
    JSON.stringify(sent[0]!.input).match(/"(body|hash|blob)[a-z_]*"/),
    null,
  );
  // 같은 ToolCall의 재전송은 같은 ID라 메시지가 하나다. 다른 ToolCall은 새 메시지다.
  const again = await run("visual.show", input);
  assertEquals(contentOf(again)["message"], contentOf(shown)["message"]);
  assertEquals(ports.messages.size, 1);
  const other = await run(
    "visual.show",
    input,
    "tcl_01arz3ndektsv4rrffq69g5faw",
  );
  assertEquals(contentOf(other)["message"], "msg_01arz3ndektsv4rrffq69g5faw");
  assertEquals(ports.messages.size, 2);
  // ToolCall ID를 모르는 자격은 새 ID를 받는다.
  const fresh = await run("visual.show", input, null);
  assertEquals(contentOf(fresh)["message"], NEXT_MESSAGE);
});

Deno.test("lophn-agent/harness/tools#R19: 거절된 시각 입력은 not_executed이고 RecordMessage를 부르지 않아 일부도 저장하지 않으며 어느 블록의 어느 상한인지 알린다", async () => {
  const { ports, run } = rig();
  const row = { name: "a" };
  const big = {
    ...tableBlock,
    key: "big",
    payload: { ...tableBlock.payload, rows: Array(1001).fill(row) },
  };
  const refused = await run("visual.show", {
    content: content(tableBlock, big),
  });
  assertEquals(refused.outcome, { kind: "not_executed", code: "not_executed" });
  assertEquals(refused.executed, false);
  assertEquals(contentOf(refused), {
    stored: false,
    rejection: {
      stage: "limit",
      block: "big",
      message:
        "table rows 1001 exceed the limit 1000; send a smaller block, it is not cut",
    },
  });
  assert(refused.result.summary.startsWith("not shown: table rows 1001"));
  const script = await run("visual.show", {
    content: content({ ...tableBlock, title: "<script>x()</script>" }),
  });
  assertEquals(contentOf(script)["rejection"], {
    stage: "markup",
    block: "counts",
    message:
      "block holds markup, script, style or a URL at title; send plain text and data only",
  });
  assertEquals(ports.calls.length, 0); // 거절은 소유 contract를 부르기 전이다.
  assertEquals(
    ports.calls.filter((call) => call.contract === "RecordMessage").length,
    0,
  );
  assertEquals(ports.messages.size, 0);
  // 모양이 틀린 입력과 모르는 field는 진입 전에 거절된다.
  const unknown = await run("visual.show", { content: content(), html: "x" });
  assertEquals(unknown.outcome.kind, "failure");
  assertEquals(unknown.executed, false);
});

Deno.test("lophn-agent/harness/tools#R19: 세션 없는 주기 run에는 visual.show가 없는 것과 같은 답이고 기록하지 않는다", async () => {
  const { ports, run } = rig({ session: null });
  const outcome = await run("visual.show", { content: content(table0) });
  assertEquals(outcome.outcome, { kind: "failure", code: "not_found" });
  assertEquals(outcome.result.summary, "tool target is not available");
  assertEquals(ports.messages.size, 0);
  // 같은 ID가 다른 내용으로 이미 있으면 소유 contract의 conflict가 안전한 문장으로 돌아온다.
  const closed = rig();
  const message = "msg_01arz3ndektsv4rrffq69g5faw";
  seed(closed.ports, { schema_version: 1, parts: [] }, message);
  const clash = await closed.run(
    "visual.show",
    { content: content(card) },
    "tcl_01arz3ndektsv4rrffq69g5faw",
  );
  assertEquals(clash.outcome, { kind: "failure", code: "conflict" });
  assertEquals(clash.result.summary, "tool call conflicted");
});

Deno.test("lophn-agent/visuals#R2: 출처는 이 run이 읽은 문서 판·이 run이 끝낸 앱 command 결과·표시한 추정뿐이고 확인하지 못한 출처는 같은 문장으로 거절한다", async () => {
  const withSource = (source: unknown) =>
    content({ ...tableBlock, sources: [source] });
  const document = {
    kind: "document",
    reference: { document: doc, version: ver },
    observed_at: null,
  };
  // 읽지 않은 문서 판은 거절된다.
  const unread = rig();
  const refused = await unread.run("visual.show", {
    content: withSource(document),
  });
  assertEquals(contentOf(refused)["rejection"], {
    stage: "source",
    block: "counts",
    message:
      "source 0 is not a document version read or an app command result run in this run",
  });
  assertEquals(unread.ports.messages.size, 0);
  // 같은 run이 document tool로 읽은 판은 받고 version 링크가 된다(handler 묶음이 읽기 기록을 나눈다).
  const read = await unread.run("document.read_version", {
    reference: { document: doc, version: ver, section: null },
  });
  assertEquals(read.outcome.kind, "success", JSON.stringify(read.result));
  const accepted = await unread.run("visual.show", {
    content: withSource(document),
  });
  assertEquals(
    accepted.outcome.kind,
    "success",
    JSON.stringify(accepted.result),
  );
  const record = unread.ports.calls.findLast((call) =>
    call.contract === "RecordMessage"
  )!;
  assertEquals(record.input["links"], [{
    kind: "version",
    document: doc,
    version: ver,
  }]);
  // 추정은 근거 없는 값을 추정으로 표시한 것이라 읽기 없이 받는다.
  const estimate = {
    kind: "estimate",
    reference: { label: "rough guess" },
    observed_at: null,
  };
  assertEquals(
    (await rig().run("visual.show", { content: withSource(estimate) })).outcome
      .kind,
    "success",
  );
  // 앱 command 결과는 이 run이 끝낸 같은 앱·release·command의 성공만 받는다.
  const command = {
    kind: "app_command",
    reference: { app, release: rel, command: "list_orders", tool_call: tcl },
    observed_at: at,
  };
  const finished = {
    id: tcl,
    run: RUN,
    state: "finished",
    outcome: { kind: "success", code: "ok" },
    app_command: { app, release: rel, command: "list_orders" },
  };
  const good = rig({ toolCall: finished });
  const shown = await good.run("visual.show", { content: withSource(command) });
  assertEquals(shown.outcome.kind, "success", JSON.stringify(shown.result));
  assertEquals(
    good.ports.calls.findLast((call) => call.contract === "RecordMessage")!
      .input["links"],
    [{ kind: "tool_call", call: tcl }],
  );
  const same = refused.result.summary;
  for (
    const options of [
      { toolCall: { ...finished, run: "run_01arz3ndektsv4rrffq69g5faw" } },
      { toolCall: { ...finished, state: "started", outcome: null } },
      { toolCall: { ...finished, outcome: { kind: "failure", code: "x" } } },
      {
        toolCall: {
          ...finished,
          app_command: { app, release: rel, command: "other" },
        },
      },
      { toolCall: { ...finished, app_command: null } },
      { toolCallError: "not_found" as const },
    ]
  ) {
    const bad = rig(options);
    const outcome = await bad.run("visual.show", {
      content: withSource(command),
    });
    assertEquals(outcome.outcome.kind, "not_executed");
    assertEquals(outcome.result.summary, same);
    assertEquals(bad.ports.messages.size, 0);
  }
  // 소유 contract를 못 읽는 때는 거절이 아니라 unavailable이다.
  const down = rig({ toolCallError: "unavailable" });
  const unavailable = await down.run("visual.show", {
    content: withSource(command),
  });
  assertEquals(unavailable.outcome, { kind: "failure", code: "unavailable" });
  // 읽기 기록이 비면(재시작) 같은 판도 다시 읽어야 한다.
  const log = createReadLog();
  const handlers = createVisualToolHandlers(world(), log);
  const call = handlers.get("visual.show")!;
  const fresh = await call({ content: withSource(document) }, credential());
  assert(fresh.ok);
  assertEquals(fresh.value.status, "not_executed");
  log.remember(RUN, doc, ver);
  const after = await call({ content: withSource(document) }, credential());
  assert(after.ok);
  assertEquals(after.value.status, "success");
});

Deno.test("lophn-agent/harness/tools#R19: visual.read는 블록 목록과 한 블록의 저장 데이터를 창으로 읽어 항목을 잃거나 겹치지 않고 다른 조건의 cursor와 없는 대상은 거절한다", async () => {
  const { ports, run } = rig();
  const rows = Array.from({ length: 1000 }, (_, i) => ({ name: `row ${i}` }));
  const table = {
    ...tableBlock,
    key: "rows",
    payload: { ...tableBlock.payload, rows },
  };
  const message = seed(ports, content(table, chartBlock, card));
  const listed = await run("visual.read", { message });
  assertEquals(listed.outcome.kind, "success");
  const blocks = contentOf(listed)["blocks"] as Record<string, unknown>[];
  assertEquals(
    blocks.map((
      block,
    ) => [block["position"], block["key"], block["kind"], block["status"]]),
    [[1, "rows", "table", "ready"], [2, "trend", "chart", "ready"], [
      3,
      "card",
      "app_card",
      "ready",
    ]],
  );
  assertEquals(blocks[0]!["title"], "counts");
  assertEquals(blocks[0]!["sources"], tableBlock.sources);
  assertFalse("payload" in blocks[0]!);
  // 1000행은 창으로 나눠 읽고 전부 한 번씩 만난다.
  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  while (true) {
    const page = await run("visual.read", {
      message,
      block_key: "rows",
      ...(cursor === undefined ? {} : { cursor }),
    });
    assertEquals(page.outcome.kind, "success", JSON.stringify(page.result));
    const body = contentOf(page);
    for (const item of body["items"] as { name: string }[]) {
      seen.push(item.name);
    }
    assertEquals(body["total_items"], 1000);
    assertEquals(body["row_count"], 1000);
    assertEquals(
      new TextEncoder().encode(JSON.stringify(page.result.content)).length <=
        24 * 1024,
      true,
    );
    pages += 1;
    if (page.result.continuation === null) {
      assertEquals(page.result.complete, true);
      break;
    }
    assertEquals(page.result.complete, false);
    cursor = page.result.continuation.read_next!;
  }
  assert(pages > 1);
  assertEquals(seen, rows.map((row) => row.name));
  // 다른 블록의 cursor를 쓰면 거절된다.
  const first = await run("visual.read", { message, block_key: "rows" });
  const wrong = await run("visual.read", {
    message,
    block_key: "trend",
    cursor: first.result.continuation!.read_next!,
  });
  assertEquals(wrong.outcome, { kind: "failure", code: "invalid_input" });
  // 차트는 점으로, 앱 카드는 저장된 참조 그대로 읽힌다(다른 앱·release로 바뀌지 않는다).
  const trend = contentOf(
    await run("visual.read", { message, block_key: "trend" }),
  );
  assertEquals(trend["items"], [
    { series: "s", x: at, y: 1 },
    { series: "s", x: "2026-10-04T01:00:00.000Z", y: null },
  ]);
  const cardRead = contentOf(
    await run("visual.read", { message, block_key: "card" }),
  );
  assertEquals(cardRead["card"], card.payload);
  // 없는 블록과 없는 메시지는 소유 contract의 같은 답이다.
  const noBlock = await run("visual.read", { message, block_key: "nope" });
  assertEquals(noBlock.outcome, { kind: "failure", code: "not_found" });
  const noMessage = await run("visual.read", {
    message: "msg_01arz3ndektsv4rrffq69g5fan",
  });
  assertEquals(noMessage.outcome, { kind: "failure", code: "not_found" });
  assertEquals(noMessage.result.summary, noBlock.result.summary);
});

Deno.test("lophn-agent/visuals#R5: 현재 검사를 통과하지 못하는 저장 블록도 visual.read가 본문·설명·출처를 그대로 보여 주고 문서 준비는 그 블록을 거절한다", async () => {
  const { ports, run } = rig();
  const stored = "msg_01arz3ndektsv4rrffq69g5fam";
  const broken = {
    ...card,
    key: "old",
    schema_version: 2,
    payload: { app: "gone", release: "gone", view: 3 },
    sources: [{
      kind: "estimate",
      reference: { label: "guess" },
      observed_at: null,
    }],
  };
  ports.messages.set(stored, {
    id: stored,
    content: {
      schema_version: 1,
      parts: [{ kind: "text", text: "kept text" }, {
        kind: "visual",
        block: broken,
      }],
    },
    links: [],
  });
  const listed = contentOf(await run("visual.read", { message: stored }));
  assertEquals(listed["blocks"], [{
    position: 1,
    key: "old",
    kind: "app_card",
    status: "unavailable",
    reason: "the stored block does not pass the current visual check",
    title: "Orders card",
    description: "the live orders screen",
    sources: broken.sources,
  }]);
  const one = await run("visual.read", { message: stored, block_key: "old" });
  assertEquals(one.outcome.kind, "success");
  assertEquals(contentOf(one)["status"], "unavailable");
  const prepared = await run("visual.prepare_document", {
    message: stored,
    block_keys: ["old"],
  });
  assertEquals(prepared.outcome, { kind: "failure", code: "not_found" });
});

Deno.test("lophn-agent/visuals#R6: visual.prepare_document는 읽기만 하고 본문 글을 창으로 주며 저장하지 않았다고 표시하고 hash를 만들지 않으며 창을 이으면 준비한 본문이다", async () => {
  const { ports, run } = rig();
  const rows = Array.from({ length: 1000 }, (_, i) => ({ name: `row ${i}` }));
  const table = {
    ...tableBlock,
    key: "rows",
    payload: { ...tableBlock.payload, rows },
  };
  const message = seed(ports, content(table, card));
  ports.calls.length = 0;
  let text = "";
  let cursor: string | undefined;
  let windows = 0;
  while (true) {
    const page = await run("visual.prepare_document", {
      message,
      block_keys: ["card", "rows"],
      ...(cursor === undefined ? {} : { cursor }),
    });
    assertEquals(page.outcome.kind, "success", JSON.stringify(page.result));
    const body = contentOf(page);
    assertEquals(body["prepared"], true);
    assertEquals(body["saved"], false);
    assertEquals(body["media_type"], "text/html");
    assertEquals(body["block_keys"], ["rows", "card"]);
    assertEquals(body["snapshots"], [
      { block_key: "card", status: "unavailable", captured_at: null },
    ]);
    assertEquals(
      JSON.stringify(body).match(/"(body_hash|spec_hash|hash)"/),
      null,
    );
    assert(
      new TextEncoder().encode(JSON.stringify(page.result.content)).length <=
        24 * 1024,
    );
    text += body["text"] as string;
    windows += 1;
    if (page.result.continuation === null) {
      assertEquals(page.result.complete, true);
      assertEquals(page.result.summary, "document body prepared, not saved");
      break;
    }
    assertEquals(page.result.summary, "document body window, not saved");
    cursor = page.result.continuation.read_next!;
  }
  assert(windows > 1);
  assert(text.startsWith("<!doctype html>\n"));
  assert(text.endsWith("</html>\n"));
  assertFalse(text.includes("<script"));
  assertEquals((text.match(/<tr><td>row /g) ?? []).length, 1000);
  assert(text.includes(`<dd>${"cd".repeat(32)}</dd>`));
  // 읽기뿐이다: 준비는 메시지 본문 읽기만 부르고 문서 저장·준비 contract는 부르지 않는다.
  assertEquals(
    [...new Set(ports.calls.map((call) => call.contract))],
    ["ReadMessageBody"],
  );
  // 고른 key 하나라도 없으면 일부만 준비하지 않고 없는 메시지와 같은 답이다.
  const missing = await run("visual.prepare_document", {
    message,
    block_keys: ["rows", "nope"],
  });
  assertEquals(missing.outcome, { kind: "failure", code: "not_found" });
  const none = await run("visual.prepare_document", {
    message: "msg_01arz3ndektsv4rrffq69g5fan",
    block_keys: ["rows"],
  });
  assertEquals(none.outcome, { kind: "failure", code: "not_found" });
  assertEquals(none.result.summary, missing.result.summary);
  // 같은 key 중복과 8개 초과는 진입 전 거절이다.
  assertEquals(
    (await run("visual.prepare_document", {
      message,
      block_keys: ["rows", "rows"],
    }))
      .outcome.kind,
    "failure",
  );
  assertEquals(
    (await run("visual.prepare_document", { message, block_keys: [] })).outcome
      .kind,
    "failure",
  );
});

Deno.test("lophn-agent/visuals#R6: 준비한 본문이 128 KiB를 넘으면 일부를 자르지 않고 더 적은 블록을 고르라고 알린다", async () => {
  const { ports, run } = rig();
  const wide = (key: string) => ({
    ...tableBlock,
    key,
    payload: {
      columns: [{ key: "c", label: "c", type: "string" }],
      rows: Array.from({ length: 1000 }, () => ({ c: "x".repeat(20) })),
    },
  });
  const message = "msg_01arz3ndektsv4rrffq69g5fap";
  ports.messages.set(message, {
    id: message,
    content: content(wide("a"), wide("b"), wide("c")),
    links: [],
  });
  const refused = await run("visual.prepare_document", {
    message,
    block_keys: ["a", "b", "c"],
  });
  assertEquals(refused.outcome.kind, "not_executed");
  assertEquals(contentOf(refused)["stored"], false);
  assert(refused.result.summary.includes("select fewer blocks"));
  // 하나만 고르면 준비된다.
  const one = await run("visual.prepare_document", {
    message,
    block_keys: ["a"],
  });
  assertEquals(one.outcome.kind, "success");
});
