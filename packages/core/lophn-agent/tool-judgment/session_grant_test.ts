// lophn-agent/harness/tool-judgment#R13, R14: session 허락이 ask를 allow로 낮추는 근거 찾기. core의
// 읽기(session·approval·tool call·event)는 주입한 호출이라 시험은 같은 route 이름으로 답하는 가짜 core를
// 쓴다. 실제 ledger에서 approval을 만들고 허락해 두 번째 호출이 새 request 없이 시작하는 흐름은
// apps/core 시험이 본다. 판정표 자체(낮추는 규칙)는 judgment_test.ts가 본다.
import { assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  sessionRead,
  toolCallList,
} from "../../../protocol/lophn-agent/mod.ts";
import { approvalsList } from "../../../protocol/approvals/mod.ts";
import { eventsList } from "../../../protocol/events/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import {
  type BasisSnapshot,
  type CoreCall,
  findSessionGrant,
  type SessionGrantQuery,
} from "./mod.ts";

const SESSION = "ses_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER_SESSION = "ses_01h455vb4pex5v6nkc6gd5fdw2";
const ASSIGNMENT = "asg_01h455vb4pex5v6nkc6gd5fdw1";
const RUN = "run_01h455vb4pex5v6nkc6gd5fdw1";
const NEXT_RUN = "run_01h455vb4pex5v6nkc6gd5fdw2";
const APPROVAL = "apr_01h455vb4pex5v6nkc6gd5fdw1";
const NEWER = "apr_01h455vb4pex5v6nkc6gd5fdw2";
const TOOL_CALL = "tcl_01h455vb4pex5v6nkc6gd5fdw1";
const NEWER_CALL = "tcl_01h455vb4pex5v6nkc6gd5fdw2";
const DOC = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER_DOC = "doc_01h455vb4pex5v6nkc6gd5fdw2";
const HASH = "ab".repeat(32);
const AT = "2026-10-05T00:00:00.000Z";

const BASIS: BasisSnapshot = {
  tool: "document.remove",
  definition_revision: "tools-1",
  description_hash: HASH,
  contract_revision: "documents-1",
  operation: "document.remove",
  input_hash: "cd".repeat(32),
  targets: [DOC],
  comparison: { seq: "41" },
  mcp_configuration_revision: null,
  agent_hash: "9f".repeat(32),
};

const QUERY: SessionGrantQuery = {
  session: SESSION,
  concern: "documents/versions",
  basis: BASIS,
};

type World = {
  session: Record<string, unknown> | "missing";
  // 허락된 request들. 최신이 앞에 온다.
  approvals: Record<string, unknown>[];
  // run별 tool call 목록.
  calls: Record<string, Record<string, unknown>[]>;
  // session event (archive·close). seq 오름차순.
  events: { seq: string; type: string }[];
  failing: string[];
};

function sessionRecord(over: Record<string, unknown> = {}) {
  return {
    id: SESSION,
    assignment: ASSIGNMENT,
    work_place: { kind: "project", id: "prj_01h455vb4pex5v6nkc6gd5fdw1" },
    title: null,
    archived: false,
    state: "open",
    forked_from: null,
    opening_context: null,
    model_selection: null,
    compaction: null,
    closed_reason: null,
    closed_at: null,
    state_seq: "10",
    ...over,
  };
}

function granted(
  id: string,
  closedSeq: string,
  over: Record<string, unknown> = {},
) {
  return {
    id,
    requester: `agent:${ASSIGNMENT}`,
    run: RUN,
    reason_blob: HASH,
    effect: {
      changes_blob: HASH,
      external_blob: null,
      reversible: false,
      reversibility_blob: HASH,
    },
    action: {
      concern: "documents/versions",
      command: "document.remove",
      caller: `agent:${ASSIGNMENT}`,
      targets: [DOC],
      input: { kind: "inline", value: { title: "note" } },
      input_hash: HASH,
      comparison: { seq: "41" },
      binding_hash: HASH,
    },
    expires_at: null,
    session_grantable: true,
    status: "granted",
    grant_scope: "session",
    grant_session: SESSION,
    closed_reason_blob: null,
    created_seq: "20",
    closed_seq: closedSeq,
    ...over,
  };
}

function toolCall(
  id: string,
  approval: string | null,
  basis: Partial<BasisSnapshot> | null,
  run = RUN,
) {
  return {
    id,
    run,
    model_call: "mcl_01h455vb4pex5v6nkc6gd5fdw1",
    response_key: "call_0",
    response_order: 0,
    tool: BASIS.tool,
    definition_revision: BASIS.definition_revision,
    effect: "write",
    app_command: null,
    confirm: false,
    extension: null,
    input: HASH,
    output: null,
    retry_of: null,
    attempt: 0,
    retry_at: null,
    decision: {
      decision: "ask",
      reason: "this call cannot be reverted",
      effect: "irreversible",
      assignment_revision: 3,
      agent_hash: BASIS.agent_hash,
      contract_revision: BASIS.contract_revision,
      comparison_basis: basis === null ? null : { ...BASIS, ...basis },
      approval,
      session_grant: null,
    },
    state: "requested",
    started_at: null,
    finished_at: null,
    duration_ms: null,
    outcome: null,
  };
}

function world(over: Partial<World> = {}): World {
  return {
    session: sessionRecord(),
    approvals: [granted(APPROVAL, "30")],
    calls: { [RUN]: [toolCall(TOOL_CALL, APPROVAL, {})] },
    events: [],
    failing: [],
    ...over,
  };
}

const common = { as_of_seq: "99", next_cursor: null };

function core(state: World, seen: { path: string; body: unknown }[] = []) {
  const call: CoreCall = (path, body) => {
    seen.push({ path, body });
    const fail = state.failing.find((entry) => path.endsWith(entry));
    if (fail !== undefined) {
      return Promise.resolve(
        err({ code: "unavailable", message: "unreachable" }),
      );
    }
    const input = body as Record<string, unknown>;
    let result: Result<unknown>;
    if (path === routePath(sessionRead)) {
      result = state.session === "missing"
        ? err({ code: "not_found", message: "no session" })
        : ok({ session: state.session, ...common });
    } else if (path === routePath(approvalsList)) {
      result = ok({
        requests: state.approvals.filter((request) =>
          input["grant_session"] === undefined ||
          request["grant_session"] === input["grant_session"]
        ),
        ...common,
      });
    } else if (path === routePath(toolCallList)) {
      result = ok({
        tool_calls: state.calls[String(input["run"])] ?? [],
        ...common,
      });
    } else if (path === routePath(eventsList)) {
      const after = BigInt(String(input["after_seq"]));
      result = ok({
        events: state.events
          .filter((event) => BigInt(event.seq) > after)
          .map((event) => ({
            seq: event.seq,
            type: event.type,
            subject: SESSION,
            actor: "user",
            run: null,
            payload: {},
            at: AT,
          })),
        scanned_through_seq: "99",
        head_seq: "99",
        ...common,
      });
    } else {
      result = err({ code: "not_found", message: path });
    }
    return Promise.resolve(result);
  };
  return call;
}

async function find(state: World, query: SessionGrantQuery = QUERY) {
  return await findSessionGrant(core(state), query);
}

Deno.test("lophn-agent/harness/tool-judgment#R14 [agent-I14]: 같은 session의 같은 tool·동작에 Allow for this session이 있으면 그 request를 근거로 찾는다", async () => {
  assertEquals(await find(world()), APPROVAL);
});

Deno.test("lophn-agent/harness/tool-judgment#R14 [agent-I14]: 대상·입력·비교 기준은 묶지 않는다 — 같은 tool·동작이면 다른 문서와 다른 입력도 같은 근거다", async () => {
  const other: SessionGrantQuery = {
    ...QUERY,
    basis: {
      ...BASIS,
      input_hash: "ef".repeat(32),
      targets: [OTHER_DOC],
      comparison: { seq: "99" },
    },
  };
  assertEquals(await find(world(), other), APPROVAL);
});

Deno.test("lophn-agent/harness/tool-judgment#R14 [agent-I14]: 허락 session으로만 찾고 다른 session·run을 가리지 않는다", async () => {
  const seen: { path: string; body: unknown }[] = [];
  assertEquals(
    await findSessionGrant(core(world(), seen), QUERY),
    APPROVAL,
  );
  const listed = seen.find((entry) => entry.path === routePath(approvalsList));
  assertEquals(
    (listed?.body as Record<string, unknown>)["grant_session"],
    SESSION,
  );
  assertEquals((listed?.body as Record<string, unknown>)["status"], "granted");
  // 다른 session의 허락은 이 session 질의에 나오지 않는다.
  const elsewhere = world({
    approvals: [granted(APPROVAL, "30", { grant_session: OTHER_SESSION })],
  });
  assertEquals(await find(elsewhere), undefined);
  // 같은 session의 다른 run에서 허락한 근거도 쓴다.
  const earlier = world({
    approvals: [granted(APPROVAL, "30", { run: NEXT_RUN })],
    calls: { [NEXT_RUN]: [toolCall(TOOL_CALL, APPROVAL, {}, NEXT_RUN)] },
  });
  assertEquals(await find(earlier), APPROVAL);
});

Deno.test("lophn-agent/harness/tool-judgment#R14 [agent-I14]: 다른 tool이나 다른 동작·concern의 허락은 근거가 아니다", async () => {
  const differentTool = world({
    calls: {
      [RUN]: [toolCall(TOOL_CALL, APPROVAL, { tool: "document.archive" })],
    },
  });
  assertEquals(await find(differentTool), undefined);
  const differentOperation = world({
    approvals: [
      granted(APPROVAL, "30", {
        action: {
          ...granted(APPROVAL, "30").action,
          command: "document.move",
        },
      }),
    ],
  });
  assertEquals(await find(differentOperation), undefined);
  const differentConcern = world({
    approvals: [
      granted(APPROVAL, "30", {
        action: {
          ...granted(APPROVAL, "30").action,
          concern: "apps/runtime",
        },
      }),
    ],
  });
  assertEquals(await find(differentConcern), undefined);
  // MCP 서버가 다르면 다른 tool이다(tool 이름이 서버를 담는다).
  const mcp: SessionGrantQuery = {
    ...QUERY,
    basis: { ...BASIS, tool: "mcp.docs.remove", mcp_configuration_revision: 4 },
  };
  const mcpWorld = world({
    calls: {
      [RUN]: [toolCall(TOOL_CALL, APPROVAL, {
        tool: "mcp.other.remove",
        mcp_configuration_revision: 4,
      })],
    },
  });
  assertEquals(await find(mcpWorld, mcp), undefined);
});

Deno.test("lophn-agent/harness/tool-judgment#R14 [agent-I14]: 허락 뒤 tool 계약·정의·MCP 연결·agent hash가 바뀌면 근거가 아니다", async () => {
  const changes: Partial<BasisSnapshot>[] = [
    { contract_revision: "documents-2" },
    { definition_revision: "tools-2" },
    { description_hash: "ef".repeat(32) },
    { mcp_configuration_revision: 5 },
    { agent_hash: "8e".repeat(32) },
  ];
  for (const change of changes) {
    // 허락할 때의 기준은 현재 기준과 같았고, 지금 기준이 한 칸 달라졌다.
    const current: SessionGrantQuery = {
      ...QUERY,
      basis: { ...BASIS, ...change },
    };
    assertEquals(
      await find(world(), current),
      undefined,
      JSON.stringify(change),
    );
  }
  // 허락 때 연결 판이 있던 MCP tool도 같은 판이면 근거다.
  const mcpBasis = { tool: "mcp.docs.remove", mcp_configuration_revision: 4 };
  const mcp: SessionGrantQuery = {
    ...QUERY,
    basis: { ...BASIS, ...mcpBasis },
  };
  assertEquals(
    await find(
      world({ calls: { [RUN]: [toolCall(TOOL_CALL, APPROVAL, mcpBasis)] } }),
      mcp,
    ),
    APPROVAL,
  );
});

Deno.test("lophn-agent/harness/tool-judgment#R14 [agent-I14]: session이 없어졌거나 닫혔거나 archive된 뒤에는 근거가 아니다", async () => {
  assertEquals(await find(world({ session: "missing" })), undefined);
  assertEquals(
    await find(world({ session: sessionRecord({ archived: true }) })),
    undefined,
  );
  assertEquals(
    await find(world({
      session: sessionRecord({
        state: "closed",
        closed_reason: "assignment_withdrawn",
        closed_at: AT,
      }),
    })),
    undefined,
  );
});

Deno.test("lophn-agent/harness/tool-judgment#R14 [agent-I14]: 허락 뒤 session이 archive되거나 닫힌 적이 있으면 다시 열려도 되살아나지 않는다", async () => {
  // 지금은 archive가 풀려 열린 session이지만 허락(seq 30) 뒤(seq 40)에 archive된 적이 있다.
  for (const type of ["SessionArchived", "SessionClosed"]) {
    assertEquals(
      await find(world({ events: [{ seq: "40", type }] })),
      undefined,
      type,
    );
  }
  // 허락 전에 있던 archive는 허락 뒤 상태와 무관하다.
  assertEquals(
    await find(world({ events: [{ seq: "25", type: "SessionArchived" }] })),
    APPROVAL,
  );
  // 두 허락 가운데 새 허락이 archive 뒤라면 새 허락만 산다.
  const both = world({
    approvals: [granted(NEWER, "50"), granted(APPROVAL, "30")],
    calls: {
      [RUN]: [
        toolCall(NEWER_CALL, NEWER, {}),
        toolCall(TOOL_CALL, APPROVAL, {}),
      ],
    },
    events: [{ seq: "40", type: "SessionArchived" }],
  });
  assertEquals(await find(both), NEWER);
});

Deno.test("lophn-agent/harness/tool-judgment#R14 [agent-I14]: 허락 session이 아니거나 이 request를 만든 호출을 찾지 못하면 근거가 아니다", async () => {
  // once로 허락한 request는 session 허락이 아니다.
  assertEquals(
    await find(world({
      approvals: [granted(APPROVAL, "30", { grant_scope: "once" })],
    })),
    undefined,
  );
  // 그 request를 만든 tool call(판정이 그 approval을 가리킨 call)이 없으면 같은 tool인지 알 수 없다.
  assertEquals(
    await find(world({ calls: { [RUN]: [toolCall(TOOL_CALL, null, {})] } })),
    undefined,
  );
  assertEquals(
    await find(world({ calls: { [RUN]: [toolCall(TOOL_CALL, NEWER, {})] } })),
    undefined,
  );
  // 판정 기준이 비어 있는 call도 같은 tool임을 말하지 못한다.
  assertEquals(
    await find(
      world({ calls: { [RUN]: [toolCall(TOOL_CALL, APPROVAL, null)] } }),
    ),
    undefined,
  );
  assertEquals(await find(world({ approvals: [] })), undefined);
});

Deno.test("lophn-agent/harness/tool-judgment#R14 [agent-I14]: 읽지 못하는 사실이 있으면 낮추지 않고 묻는다", async () => {
  for (
    const path of [
      routePath(sessionRead),
      routePath(approvalsList),
      routePath(toolCallList),
      routePath(eventsList),
    ]
  ) {
    assertEquals(
      await find(world({ failing: [path] })),
      undefined,
      path,
    );
  }
});
