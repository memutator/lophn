// coding-agent#T16 끝에서 끝까지: coding agent가 MCP `lophn_question`·`lophn_approval`로
// 실제 core의 질문과 approval request를 읽는다. core는 실제 자식 프로세스이고 데이터 root는
// temp dir다. 질문은 lophn-agent의 실제 command(agent run 안의 CreateQuestion)로, approval은
// 실제 `create_approval_request`로 만들고, coding credential은 읽기 route 말고는 열지 못한다.
// 사람 데이터 root(~/.lophn)는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import { createApprovalTool } from "../../packages/coding-agent/mcp-server/tools/approval.ts";
import { createQuestionTool } from "../../packages/coding-agent/mcp-server/tools/question.ts";
import { createHandler } from "../../packages/coding-agent/mcp-server/server.ts";
import { resolveRoute } from "../../packages/coding-agent/mcp-server/registry.ts";
import { presetDefinitionJson } from "../../packages/lophn-agent/harness/run-loop/testing/mod.ts";
import { hashOf } from "../../packages/lophn-agent/questions/testing/mod.ts";
import { type Core, startCore } from "./core.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";

const teams = [
  { lophnAgentDefinitions },
];

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}
const BODY = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

const CAC = id("cac", 1);
const OTHER_CAC = id("cac", 2);
const ASG = id("asg", 1);
const RUN = id("run", 1);
const CODING_TOKEN = "a".repeat(43);
const OTHER_TOKEN = "c".repeat(43);
const MACHINE_TOKEN = "b".repeat(43);
const AGENT_TOKEN = "d".repeat(43);
const USER_TOKEN = "e".repeat(43);
const READ_OPERATIONS = [
  "ListQuestions",
  "ReadQuestion",
  "ListApprovals",
  "GetApproval",
];

type Opened = {
  core: Core;
  home: string;
  dispose(): Promise<void>;
};

function context(
  actor: string,
  token: string,
  operations: string[],
  targets: Record<string, string> = {},
): [AuthenticatedContext, string] {
  return [{
    principal: actor,
    actor,
    scope: { operations, targets },
    conditions: targets,
    credential_ref: `cred-${actor}`,
  }, token];
}

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-decisions-e2e-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(31),
    testCredentials: true,
    superviseIo: false,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const contexts = [
    context(`coding_agent:${CAC}`, CODING_TOKEN, [
      ...READ_OPERATIONS,
      "CreateApprovalRequest",
      "create_approval_request",
      // 결정·소비 route를 열어 두어도 actor 자격으로 거절되는지 본다.
      "AnswerQuestion",
      "DeferQuestion",
      "CancelQuestion",
      "grant_approval_request",
      "reject_approval_request",
      "ApplySettings",
      "ApplyQuestionOption",
    ]),
    context(`coding_agent:${OTHER_CAC}`, OTHER_TOKEN, [
      ...READ_OPERATIONS,
      "create_approval_request",
    ]),
    context("machine", MACHINE_TOKEN, [
      "RegisterDefaultPreset",
      "CreateBuiltinAssignment",
      "AcceptRun",
      "StartRun",
      "expire_approval_request",
      ...READ_OPERATIONS,
    ]),
    context(`agent:${ASG}`, AGENT_TOKEN, ["CreateQuestion"], {
      assignment: ASG,
      run: RUN,
    }),
    context("user", USER_TOKEN, [
      ...READ_OPERATIONS,
      "AnswerQuestion",
      "DeferQuestion",
      "cancel_approval_request",
    ]),
  ];
  for (const [credential, token] of contexts) {
    const accepted = await core.acceptTestCredential?.(credential, token);
    assert(accepted?.ok);
    const recorded = await core.record(credential);
    assert(recorded.ok);
  }
  return {
    core,
    home,
    async dispose() {
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
    },
  };
}

let counter = 0;
async function post(
  opened: Opened,
  path: string,
  input: unknown,
  token: string,
  compare: unknown = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  counter++;
  const response = await fetch(
    `http://127.0.0.1:${opened.core.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        input,
        idempotency_key: `decisions-${counter}`,
        compare,
        prepared: [],
      }),
    },
  );
  return {
    status: response.status,
    body: JSON.parse(await response.text()) as Record<string, unknown>,
  };
}

async function ok(
  opened: Opened,
  path: string,
  input: unknown,
  token: string,
  compare: unknown = {},
) {
  const sent = await post(opened, path, input, token, compare);
  assertEquals(sent.status, 200, `${path}: ${JSON.stringify(sent.body)}`);
  return sent.body;
}

// 실제 lophn-agent command로 agent run 하나를 시작한다. 질문은 그 run이 만든다.
async function startRun(opened: Opened) {
  const definition = presetDefinitionJson("lophn");
  await ok(opened, "presets/register-default", {
    id: id("pst", 1),
    definition,
    definition_hash: hashOf(definition),
  }, MACHINE_TOKEN);
  await ok(opened, "assignments/create-builtin", {
    id: ASG,
    preset: id("pst", 1),
    preset_revision: 1,
    role: "lophn",
    scope: { kind: "all", id: null },
  }, MACHINE_TOKEN);
  const accepted = await ok(
    opened,
    "runs/accept",
    {
      id: RUN,
      assignment: ASG,
      session: null,
      source: { kind: "message", message: id("msg", 1) },
      continued_from: null,
      start_after: null,
    },
    MACHINE_TOKEN,
    { assignment_revision: 1 },
  );
  await ok(
    opened,
    "runs/start",
    {
      run: RUN,
      basis: "b".repeat(64),
      limits: { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 },
      scope: { role: "lophn", assignment: ASG, apps: [] },
    },
    MACHINE_TOKEN,
    {
      state_seq: String(accepted.state_seq),
    },
  );
}

function coding(opened: Opened, token = CODING_TOKEN, connection = CAC) {
  const client = createCoreClient({
    baseUrl: `http://127.0.0.1:${opened.core.port}`,
    connection,
    provider: () => Promise.resolve({ ok: true, value: { token } }),
  });
  const question = createQuestionTool({ client });
  const approval = createApprovalTool({ client });
  // MCP 입구와 같은 길이다: tools/call이 입력을 검사하고 tool을 실행한다.
  const handler = createHandler({
    toolsets: ["core"],
    callTool: (name, args) => {
      const resolved = resolveRoute(name, (args as { op?: string }).op);
      assert(resolved);
      return (name === "lophn_question" ? question : approval)(
        name,
        resolved.route,
        args,
      );
    },
  });
  return {
    client,
    async call(name: string, args: unknown) {
      const reply = await handler(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }));
      return (reply as {
        result: {
          isError?: boolean;
          structuredContent: {
            summary: string;
            data: Record<string, unknown>;
            next: string[];
          };
        };
      }).result;
    },
  };
}

function approvalInput(n: number, requester: string) {
  const action = {
    concern: "apps/releases",
    command: "activate_release",
    caller: requester,
    targets: [id("app", 1)],
    input: { kind: "inline", value: { release: `r${n}` } },
    input_hash: BODY(n + 10),
    comparison: { revision: n },
    binding_hash: BODY(n + 20),
  };
  return {
    id: id("apr", n),
    requester,
    run: null,
    reason_blob: BODY(n + 30),
    effect: {
      changes_blob: BODY(n + 40),
      external_blob: null,
      reversible: false,
      reversibility_blob: BODY(n + 50),
    },
    action,
    expires_at: "2024-01-02T00:00:00.000Z",
  };
}

Deno.test("coding-agent/mcp-server#R18: 실제 core의 대기 질문을 이유·option과 결정 화면 링크로 읽고 답 op는 닫혀 있다", async () => {
  const opened = await open();
  try {
    await startRun(opened);
    const question = id("qst", 1);
    await ok(opened, "questions/create", {
      id: question,
      run: RUN,
      session: null,
      prompt_blob: BODY(1),
      reason_blob: BODY(2),
      options: [{
        key: "a",
        label: "Option a",
        description_blob: BODY(3),
        evidence: [],
        adoption: null,
        action: null,
      }],
      recommendation: null,
      expires_at: null,
    }, AGENT_TOKEN);
    const { call } = coding(opened);
    const shown = await call("lophn_question", { op: "show", question });
    assertEquals(shown.isError, undefined, JSON.stringify(shown));
    const record = (shown.structuredContent.data as {
      question: Record<string, unknown>;
    }).question;
    assertEquals(record.state, "waiting");
    assertEquals(record.decision_link, `lophn://things-to-confirm/${question}`);
    assertEquals(record.reason_blob, BODY(2));
    assertEquals((record.options as { key: string }[])[0].key, "a");
    const listed = await call("lophn_question", {
      op: "list",
      status: "pending",
    });
    assertEquals(listed.isError, undefined);
    assertEquals(listed.structuredContent.summary, "질문 1개, 대기 1개");
    // answer op는 tool 표에 없다. coding credential의 직접 요청도 core가 거절한다.
    const answer = await call("lophn_question", {
      op: "answer",
      question,
    });
    assertEquals(answer.isError, true);
    const direct = await post(
      opened,
      "questions/answer",
      {
        question,
        created_seq: String(record.created_seq),
        answer: { kind: "text", option_key: null, text_blob: BODY(9) },
        binding_hash: null,
        evidence: null,
      },
      CODING_TOKEN,
      { created_seq: String(record.created_seq) },
    );
    assertEquals(direct.status, 403, JSON.stringify(direct.body));
    // 거절 뒤에도 질문은 그대로 대기다.
    const after = await call("lophn_question", { op: "show", question });
    assertEquals(
      (after.structuredContent.data as { question: { state: string } })
        .question.state,
      "waiting",
    );
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R18: 없는 질문은 isError로 응답에 닿는다", async () => {
  const opened = await open();
  try {
    const { call } = coding(opened);
    const missing = await call("lophn_question", {
      op: "show",
      question: id("qst", 9),
    });
    assertEquals(missing.isError, true);
    assertEquals(
      (missing.structuredContent.data as { code: string }).code,
      "not_found",
    );
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/connection#R7: 같은 연결로 질문 답·미루기·option 적용·settings 변경 요청이 거절되고 대기는 그대로다", async () => {
  const opened = await open();
  try {
    await startRun(opened);
    const question = id("qst", 1);
    await ok(opened, "questions/create", {
      id: question,
      run: RUN,
      session: null,
      prompt_blob: BODY(1),
      reason_blob: BODY(2),
      options: [],
      recommendation: null,
      expires_at: null,
    }, AGENT_TOKEN);
    const { call } = coding(opened);
    const shown = await call("lophn_question", { op: "show", question });
    const createdSeq = String(
      (shown.structuredContent.data as {
        question: { created_seq: string };
      }).question.created_seq,
    );
    const attempts: [string, unknown, unknown][] = [
      ["questions/defer", { question, created_seq: createdSeq }, {
        created_seq: createdSeq,
      }],
      ["questions/cancel", {
        question,
        created_seq: createdSeq,
        closed_reason: "cancelled",
        closed_reason_blob: BODY(5),
      }, { created_seq: createdSeq }],
      ["questions/apply-option", {
        question,
        answered_seq: createdSeq,
        option_key: "a",
        action: {},
        evidence: {},
      }, {}],
      ["settings/apply", { changes: [] }, {}],
    ];
    for (const [path, input, compare] of attempts) {
      const sent = await post(opened, path, input, CODING_TOKEN, compare);
      assert(sent.status >= 400, `${path}: ${JSON.stringify(sent.body)}`);
    }
    const after = await call("lophn_question", { op: "show", question });
    assertEquals(
      (after.structuredContent.data as { question: { state: string } })
        .question.state,
      "waiting",
    );
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R18: 사람이 미룬 질문은 대기가 아니라 미룸으로 읽히고 대기 목록에서 빠진다", async () => {
  const opened = await open();
  try {
    await startRun(opened);
    const question = id("qst", 1);
    await ok(opened, "questions/create", {
      id: question,
      run: RUN,
      session: null,
      prompt_blob: BODY(1),
      reason_blob: BODY(2),
      options: [],
      recommendation: null,
      expires_at: null,
    }, AGENT_TOKEN);
    const { call } = coding(opened);
    const shown = await call("lophn_question", { op: "show", question });
    const createdSeq = String(
      (shown.structuredContent.data as {
        question: { created_seq: string };
      }).question.created_seq,
    );
    await ok(
      opened,
      "questions/defer",
      {
        question,
        created_seq: createdSeq,
      },
      USER_TOKEN,
      { created_seq: createdSeq },
    );
    const deferred = await call("lophn_question", { op: "show", question });
    const record = (deferred.structuredContent.data as {
      question: Record<string, unknown>;
    }).question;
    assertEquals(record.state, "deferred");
    assertEquals(record.decision_link, null);
    assertEquals(record.applied, false);
    const waiting = await call("lophn_question", {
      op: "list",
      status: "pending",
    });
    assertEquals(waiting.structuredContent.summary, "질문 0개, 대기 0개");
    const all = await call("lophn_question", { op: "list" });
    assertEquals(all.structuredContent.summary, "질문 1개, 대기 0개");
  } finally {
    await opened.dispose();
  }
});
