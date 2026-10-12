// lophn-agent#T33 끝에서 끝까지: 시각 tool을 실제 core와 임시 LOPHN_HOME에서 본다. model provider와
// 사람 데이터 root는 쓰지 않는다. tool handler는 값만 싣고(hash·blob 없음) core가 redaction과 blob
// 준비·영구 참조를 맡는다. 문서 저장은 documents worker가 필요해 문서 tool의 시험(document-tools_test)이
// 보고 여기서는 준비한 본문까지만 본다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  err,
  type ManualClock,
  manualClock,
  ok,
  type Result,
  seededRandom,
  sha256Hex,
} from "../../packages/base/mod.ts";
import {
  ROUTES,
  serializeMessageContent,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { tableBlock } from "../../packages/protocol/lophn-agent/message-fixtures.ts";
import type { AuthenticatedContext } from "../../packages/protocol/server/mod.ts";
import {
  BUILTIN_TOOLS,
  createBuiltinToolHandlers,
  executeTool,
  listTools,
  type RunCredential,
  runOperations,
} from "../../packages/core/lophn-agent/tools/mod.ts";
import { id } from "../../packages/core/lophn-agent/session/testing/mod.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration as documentsRegistration } from "./documents.ts";
import {
  createLedgerRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";

const NOW = Date.UTC(2024, 0, 1);
const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123";
// 메시지 ID는 ToolCall ID의 ULID에서 나므로 사람이 보낸 메시지(msg 1)와 겹치지 않는 값이다.
const TOOL_CALL = id("tcl", 50);

type Fixture = {
  home: string;
  clock: ManualClock;
  starts: number;
  tokens: number;
};

async function fixture(): Promise<Fixture> {
  return {
    home: await Deno.makeTempDir({ prefix: "lophn-visual-tools-" }),
    clock: manualClock(NOW),
    starts: 0,
    tokens: 0,
  };
}

async function start(f: Fixture): Promise<Core> {
  const started = await startCore({
    lophnHome: f.home,
    port: 0,
    teams: [
      { lophnAgentDefinitions },
      { createLedgerRegistration },
      { createLedgerRegistration: documentsRegistration },
    ],
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
    ],
    clock: f.clock,
    random: seededRandom(300 + ++f.starts),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  return started.value;
}

// agent 자격이 가지는 operation은 제공 목록이 가리키는 소유 contract와 그 보조뿐이다. 사람의 자격은
// 시험이 세션을 여는 데 쓰는 것만 더한다.
const AGENT_OPERATIONS = [...runOperations(BUILTIN_TOOLS)];
const USER_OPERATIONS = [
  "ListAssignments",
  "OpenSession",
  "ReadSession",
  "ReceiveMessage",
  "ReadMessageBody",
  "project.create",
];

async function grant(
  f: Fixture,
  core: Core,
  actor: string,
  extra: { assignment?: string; run?: string } = {},
): Promise<string> {
  const n = ++f.tokens;
  const bound = extra.assignment === undefined ? {} : {
    assignment: extra.assignment,
    ...(extra.run === undefined ? {} : { run: extra.run }),
  };
  const context: AuthenticatedContext = {
    principal: actor.startsWith("agent:") ? actor : `${actor}-${n}`,
    actor: actor as AuthenticatedContext["actor"],
    credential_ref: `cred_visual${n}_${f.starts}`,
    scope: {
      operations: actor.startsWith("agent:")
        ? AGENT_OPERATIONS
        : USER_OPERATIONS,
      targets: bound,
    },
    conditions: bound,
  };
  const token = `${actor.replace(/\W/g, "x")}${n}`.padEnd(43, "t");
  assert(core.acceptTestCredential);
  assert((await core.acceptTestCredential(context, token)).ok);
  assert((await core.record(context)).ok);
  return token;
}

async function post(port: number, path: string, body: unknown, token: string) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function command(input: unknown, key: string, compare: unknown, run?: string) {
  return {
    input,
    idempotency_key: key,
    compare,
    prepared: [],
    ...(run === undefined ? {} : { run }),
  };
}

type Assignment = { id: string; role: string; revision: number; state: string };

async function openRun(f: Fixture, core: Core) {
  const user = await grant(f, core, "user");
  const listed = await post(core.port, "assignments/list", {}, user);
  const lophn = (listed.body as { assignments: Assignment[] }).assignments
    .find((entry) => entry.role === "lophn")!;
  const session = id("ses", 1);
  // 세션은 쓸 수 있는 project 하나를 자리로 받는다.
  const place = await post(
    core.port,
    "projects/create",
    command(
      {
        id: id("prj", 1),
        name: "alpha",
        title: "alpha",
        purpose: "",
        folders: [],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      },
      "place",
      {},
    ),
    user,
  );
  assertEquals(place.status, 200, JSON.stringify(place.body));
  const opened = await post(
    core.port,
    "sessions/open",
    command(
      {
        id: session,
        assignment: lophn.id,
        work_place: { kind: "project", id: id("prj", 1) },
        opening_context: null,
      },
      "open",
      { assignment_revision: lophn.revision, assignment_state: lophn.state },
    ),
    user,
  );
  assertEquals(opened.status, 200, JSON.stringify(opened.body));
  const state = await post(core.port, "sessions/read", { session }, user);
  const stateSeq = (state.body as { session: { state_seq: string } }).session
    .state_seq;
  const sent = await post(
    core.port,
    "messages/receive",
    command(
      {
        id: id("msg", 1),
        session,
        content: {
          schema_version: 1,
          parts: [{ kind: "text", text: "show me the numbers" }],
        },
        mode: "request",
      },
      "send",
      {
        session_state: "open",
        session_state_seq: stateSeq,
        assignment_revision: lophn.revision,
        assignment_state: lophn.state,
      },
    ),
    user,
  );
  assertEquals(sent.status, 200, JSON.stringify(sent.body));
  const run = (sent.body as { message: { run: string } }).message.run;
  return { user, lophn, session, run };
}

// tool handler가 부르는 소유 contract를 실제 core의 HTTP route로 잇는다. 호출 run에 묶인 자격으로만
// 부른다(run-loop의 조립이 하는 일과 같은 모양이다).
function tools(
  core: Core,
  token: string,
  facts: { session: string; run: string },
) {
  const ports = {
    call(contract: string, input: unknown, run: string) {
      const route = ROUTES.find((candidate) => candidate.name === contract);
      assert(route !== undefined, contract);
      const body = input as Record<string, unknown>;
      const path = `${route.resource}/${route.method}`;
      return post(
        core.port,
        path,
        route.kind === "command"
          ? command(input, `idem-${String(body["id"])}`, {}, run)
          : input,
        token,
      ).then((reply): Result<unknown> =>
        reply.status === 200 ? ok(reply.body) : err({
          code: ((reply.body as { error?: { code?: string } }).error?.code ??
            "internal") as "internal",
          message: "core refused",
        })
      );
    },
    newId: () => id("msg", 99),
    runFacts: () =>
      Promise.resolve(ok({
        session: facts.session,
        role: "lophn" as const,
        original_message: id("msg", 1),
        assignment: "asg_01arz3ndektsv4rrffq69g5fav",
      })),
  };
  const listed = listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    {
      presetTools: BUILTIN_TOOLS.map((tool) => tool.name),
      roleTools: BUILTIN_TOOLS.map((tool) => tool.name),
    },
  );
  const handlers = createBuiltinToolHandlers(ports);
  const credential = (call = TOOL_CALL): RunCredential => ({
    run: facts.run,
    targets: new Set(),
    operations: new Set(AGENT_OPERATIONS),
    call,
  });
  return {
    run: (name: string, input: unknown, call?: string) =>
      executeTool(
        { listed, handlers, credential: credential(call) },
        name,
        input,
      ),
  };
}

function ledger(home: string): DatabaseSync {
  return new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
}

function refsOf(
  home: string,
  message?: string,
): Record<string, unknown>[] {
  const db = ledger(home);
  try {
    const rows = db.prepare(
      "select owner_key, field, hash, size_bytes from blob_refs where owner_kind = 'message' order by owner_key",
    ).all() as Record<string, unknown>[];
    return message === undefined
      ? rows
      : rows.filter((row) => row["owner_key"] === message);
  } finally {
    db.close();
  }
}

async function blobHashes(home: string): Promise<string[]> {
  const found: string[] = [];
  try {
    for await (const prefix of Deno.readDir(`${home}/blobs/sha256`)) {
      if (!prefix.isDirectory) continue;
      for await (
        const name of Deno.readDir(`${home}/blobs/sha256/${prefix.name}`)
      ) {
        if (name.isFile) found.push(`${prefix.name}${name.name}`);
      }
    }
  } catch {
    return found;
  }
  return found.sort();
}

const shown = {
  schema_version: 1,
  parts: [
    { kind: "text", text: `first, a token ${SECRET} in the text` },
    {
      kind: "visual",
      block: {
        ...tableBlock,
        sources: [],
        description: `counts from the export, key ${SECRET}`,
      },
    },
    // 중간에 끊긴 JSON 조각은 블록이 아니라 글로 남는다.
    { kind: "text", text: '{"kind":"table","payload":{"rows":[{"a":1},' },
  ],
};

Deno.test("lophn-agent/conversation#R12: visual.show가 남긴 글과 블록은 core가 redaction해 순서대로 한 본문 blob으로 저장하고 core를 다시 띄운 뒤에도 같은 명세로 읽힌다", async () => {
  const f = await fixture();
  try {
    let message = "";
    let hash = "";
    {
      const core = await start(f);
      try {
        const { lophn, session, run } = await openRun(f, core);
        const agent = await grant(f, core, `agent:${lophn.id}`, {
          assignment: lophn.id,
          run,
        });
        const t = tools(core, agent, { session, run });
        const result = await t.run("visual.show", { content: shown });
        assertEquals(result.outcome.kind, "success", JSON.stringify(result));
        message = (result.result.content as { message: string }).message;
        assertEquals(message, `msg_${TOOL_CALL.slice(4)}`);
        // 같은 ToolCall의 재전송은 메시지도 blob도 늘리지 않는다.
        const before = await blobHashes(f.home);
        const again = await t.run("visual.show", { content: shown });
        assertEquals(again.outcome.kind, "success", JSON.stringify(again));
        assertEquals(refsOf(f.home, message).length, 1);
        assertEquals(await blobHashes(f.home), before);
        // 읽기 tool은 redaction된 값과 순서를 돌려준다.
        const listed = await t.run("visual.read", { message });
        assertEquals(listed.outcome.kind, "success");
        const blocks = (listed.result.content as {
          blocks: { key: string; description: string; position: number }[];
        }).blocks;
        assertEquals(blocks.map((b) => [b.position, b.key]), [[1, "counts"]]);
        assertEquals(blocks[0]!.description, "counts from the export, key *");
        // 본문 blob은 정규 직렬화된 redaction본이고 ledger에는 그 hash만 있다.
        const refs = refsOf(f.home, message);
        assertEquals(refs.map((r) => [r["owner_key"], r["field"]]), [[
          message,
          "body",
        ]]);
        hash = String(refs[0]!["hash"]);
        const stored = await Deno.readTextFile(
          `${f.home}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`,
        );
        assertEquals(await sha256Hex(new TextEncoder().encode(stored)), hash);
        assert(!stored.includes(SECRET));
        const expected = {
          ...shown,
          parts: [
            { kind: "text", text: "first, a token * in the text" },
            {
              kind: "visual",
              block: {
                ...(shown.parts[1] as { block: object }).block,
                description: "counts from the export, key *",
              },
            },
            shown.parts[2],
          ],
        };
        assertEquals(
          new TextDecoder().decode(serializeMessageContent(expected)),
          stored,
        );
      } finally {
        await core.shutdown();
      }
    }
    const again = await start(f);
    try {
      const { lophn, session, run } = await restoreRun(f, again);
      const agent = await grant(f, again, `agent:${lophn.id}`, {
        assignment: lophn.id,
        run,
      });
      const t = tools(again, agent, { session, run });
      const body = await post(again.port, "messages/body", { message }, agent);
      assertEquals(body.status, 200, JSON.stringify(body.body));
      const content = body.body as {
        body: string;
        content: { parts: { kind: string; text?: string }[] };
      };
      assertEquals(content.body, hash);
      assertEquals(content.content.parts.map((part) => part.kind), [
        "text",
        "visual",
        "text",
      ]);
      // 끊긴 조각은 글 그대로이고 블록으로 바뀌지 않았다.
      assertEquals(
        content.content.parts[2]!.text,
        '{"kind":"table","payload":{"rows":[{"a":1},',
      );
      const read = await t.run("visual.read", { message, block_key: "counts" });
      assertEquals(read.outcome.kind, "success", JSON.stringify(read));
      const block = read.result.content as {
        items: unknown[];
        title: string;
        total_items: number;
      };
      assertEquals(block.title, "counts");
      assertEquals(block.items, [{ name: "a" }]);
    } finally {
      await again.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

// 재시작 뒤 같은 run을 다시 찾는다. 세션·run은 ledger에 있고 자격만 새로 받는다.
async function restoreRun(f: Fixture, core: Core) {
  const user = await grant(f, core, "user");
  const listed = await post(core.port, "assignments/list", {}, user);
  const lophn = (listed.body as { assignments: Assignment[] }).assignments
    .find((entry) => entry.role === "lophn")!;
  const read = await post(
    core.port,
    "messages/body",
    { message: id("msg", 1) },
    user,
  );
  assertEquals(read.status, 200, JSON.stringify(read.body));
  const db = ledger(f.home);
  try {
    const row = db.prepare("select id from runs limit 1").get() as {
      id: string;
    };
    return { user, lophn, session: id("ses", 1), run: row.id };
  } finally {
    db.close();
  }
}

Deno.test("lophn-agent/conversation#R13: 거절된 시각 메시지는 아무것도 저장하지 않고 owner도 markup·URL 블록을 거절하며 blob과 참조가 늘지 않는다", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const { lophn, session, run } = await openRun(f, core);
      const agent = await grant(f, core, `agent:${lophn.id}`, {
        assignment: lophn.id,
        run,
      });
      const t = tools(core, agent, { session, run });
      const before = { refs: refsOf(f.home), blobs: await blobHashes(f.home) };
      // tool 진입 검사: 단계와 자리를 알리고 core를 부르지 않는다.
      const bad = {
        schema_version: 1,
        parts: [{
          kind: "visual",
          block: { ...tableBlock, sources: [], title: "<b>hi</b>" },
        }],
      };
      const refused = await t.run("visual.show", { content: bad });
      assertEquals(refused.outcome.kind, "not_executed");
      assertEquals(refused.executed, false);
      // owner 검사: 어떤 경로로 와도 같다. 계약은 통과하지만 URL을 담은 블록을 core가 거절한다.
      const direct = await post(
        core.port,
        "messages/record",
        command(
          {
            id: id("msg", 5),
            session,
            run,
            content: {
              schema_version: 1,
              parts: [{
                kind: "visual",
                block: {
                  ...tableBlock,
                  sources: [],
                  description: "open https://evil.example/x now",
                },
              }],
            },
            links: [],
          },
          "direct",
          {},
          run,
        ),
        agent,
      );
      assertEquals(direct.status, 400, JSON.stringify(direct.body));
      assertEquals(
        (direct.body as { error: { code: string } }).error.code,
        "invalid_input",
      );
      // 상한을 넘는 블록은 어느 경로로도 자르지 않고 전체 거절이다.
      const rows = Array.from({ length: 1001 }, () => ({ name: "a" }));
      const oversize = await post(
        core.port,
        "messages/record",
        command(
          {
            id: id("msg", 6),
            session,
            run,
            content: {
              schema_version: 1,
              parts: [{
                kind: "visual",
                block: {
                  ...tableBlock,
                  sources: [],
                  payload: { ...tableBlock.payload, rows },
                },
              }],
            },
            links: [],
          },
          "oversize",
          {},
          run,
        ),
        agent,
      );
      assertEquals(oversize.status, 400, JSON.stringify(oversize.body));
      assertEquals(refsOf(f.home), before.refs);
      assertEquals(await blobHashes(f.home), before.blobs);
      // 거절 뒤에도 바른 메시지는 기록된다(renderer 실패가 아니라 입력 거절이다).
      const ok_ = await t.run("visual.show", { content: shown });
      assertEquals(ok_.outcome.kind, "success", JSON.stringify(ok_));
      assertNotEquals(refsOf(f.home), before.refs);
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/visuals#R6: 실제 core의 확정 메시지에서 visual.prepare_document가 읽은 본문 hash로 고정한 HTML을 준비하고 아무것도 저장하지 않는다", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const { lophn, session, run } = await openRun(f, core);
      const agent = await grant(f, core, `agent:${lophn.id}`, {
        assignment: lophn.id,
        run,
      });
      const t = tools(core, agent, { session, run });
      const result = await t.run("visual.show", { content: shown });
      const message = (result.result.content as { message: string }).message;
      const hash = String(refsOf(f.home, message)[0]!["hash"]);
      const refsBefore = refsOf(f.home);
      const blobsBefore = await blobHashes(f.home);
      const prepared = await t.run("visual.prepare_document", {
        message,
        block_keys: ["counts"],
      });
      assertEquals(prepared.outcome.kind, "success", JSON.stringify(prepared));
      const body = prepared.result.content as {
        saved: boolean;
        text: string;
        snapshots: unknown[];
      };
      assertEquals(body.saved, false);
      assertEquals(prepared.result.complete, true);
      assert(body.text.startsWith("<!doctype html>"));
      assert(body.text.includes(`<dd>${hash}</dd>`));
      assert(body.text.includes(`<dd>${message}</dd>`));
      assert(!body.text.includes(SECRET));
      assert(!body.text.includes("<script"));
      // 준비는 읽기뿐이다: 새 blob·참조·메시지가 없다.
      assertEquals(refsOf(f.home), refsBefore);
      assertEquals(await blobHashes(f.home), blobsBefore);
      // 없는 메시지는 읽을 수 없는 메시지와 같은 not_found다.
      const missing = await t.run("visual.prepare_document", {
        message: id("msg", 77),
        block_keys: ["counts"],
      });
      assertEquals(missing.outcome, { kind: "failure", code: "not_found" });
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});
