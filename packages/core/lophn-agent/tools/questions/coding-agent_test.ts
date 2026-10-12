// coding-agent#T16 끝에서 끝까지: coding agent가 MCP `lophn_question`으로 실제 core의
// 질문을 읽는다. core는 실제 자식 프로세스이고 데이터 root는 temp dir다. 질문은
// lophn-agent의 실제 command(agent run 안의 CreateQuestionGroup)로 만들고, coding credential은
// 읽기 route 말고는 열지 못한다. approval은 제품 core가 아직 서빙하지 않아
// coding-agent-approvals_test.ts가 맡는다. 사람 데이터 root(~/.lophn)는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { createCoreClient } from "../../../../coding-agent/connection/client/core.ts";
import { createQuestionTool } from "../../../../coding-agent/mcp-server/tools/question.ts";
import { createHandler } from "../../../../coding-agent/mcp-server/server.ts";
import { resolveRoute } from "../../../../coding-agent/mcp-server/registry.ts";
import { sha256Text } from "./testing/mod.ts";
import { type Core, startCore } from "../../../main/daemon/core.ts";
import { lophnAgentDefinitions } from "../../register.ts";
import { closeUnlessKept } from "../../../testing/close-on-throw.ts";

const teams = [
  { lophnAgentDefinitions },
];

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const CAC = id("cac", 1);
const RUN = id("run", 1);
const CODING_TOKEN = "a".repeat(43);
const MACHINE_TOKEN = "b".repeat(43);
const AGENT_TOKEN = "d".repeat(43);
const USER_TOKEN = "e".repeat(43);
const READ_OPERATIONS = [
  "ListQuestionGroups",
  "ReadQuestionGroup",
  "ListApprovals",
  "GetApproval",
];

type Opened = {
  core: Core;
  home: string;
  // core 기동이 준비한 lophn assignment.
  asg: string;
  revision: number;
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
      new URL("../../register.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(31),
    // 질문 글은 core가 blob으로 준비하므로 I/O 감독이 떠 있어야 한다. 기동이 lophn
    // assignment를 준비한다.
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
  });
  const core = started.value;
  const accept = async (
    [credential, token]: [AuthenticatedContext, string],
  ) => {
    const accepted = await core.acceptTestCredential?.(credential, token);
    assert(accepted?.ok);
    const recorded = await core.record(credential);
    assert(recorded.ok);
  };
  const contexts = [
    context(`coding_agent:${CAC}`, CODING_TOKEN, [
      ...READ_OPERATIONS,
      // 결정·소비 route를 열어 두어도 actor 자격으로 거절되는지 본다.
      "AnswerQuestionGroup",
      "DeferQuestionGroup",
      "CancelQuestionGroup",
      "ApplySettings",
      "ApplyQuestionOption",
    ]),
    context("machine", MACHINE_TOKEN, [
      "ListAssignments",
      "AcceptRun",
      "StartRun",
      ...READ_OPERATIONS,
    ]),
    context("user", USER_TOKEN, [
      ...READ_OPERATIONS,
      "AnswerQuestionGroup",
      "DeferQuestionGroup",
    ]),
  ];
  for (const one of contexts) await accept(one);
  const listed = await fetch(
    `http://127.0.0.1:${core.port}/v1/assignments/list`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${MACHINE_TOKEN}`,
      },
      body: "{}",
    },
  );
  const assignments = (await listed.json() as {
    assignments: { id: string; role: string; revision: number }[];
  }).assignments;
  const lophn = assignments.find((entry) => entry.role === "lophn");
  assert(lophn, "core 기동이 lophn assignment를 준비한다");
  await accept(
    context(`agent:${lophn.id}`, AGENT_TOKEN, ["CreateQuestionGroup"], {
      assignment: lophn.id,
      run: RUN,
    }),
  );
  guard.keep();
  return {
    core,
    home,
    asg: lophn.id,
    revision: lophn.revision,
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
  const accepted = await ok(
    opened,
    "runs/accept",
    {
      id: RUN,
      assignment: opened.asg,
      session: null,
      source: { kind: "message", message: id("msg", 1) },
      continued_from: null,
      start_after: null,
    },
    MACHINE_TOKEN,
    { assignment_revision: opened.revision },
  );
  await ok(
    opened,
    "runs/start",
    {
      run: RUN,
      basis: "b".repeat(64),
      limits: { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 },
      scope: { role: "lophn", assignment: opened.asg, apps: [] },
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
  // MCP 입구와 같은 길이다: tools/call이 입력을 검사하고 tool을 실행한다.
  const handler = createHandler({
    toolsets: ["core"],
    callTool: (name, args) => {
      const resolved = resolveRoute(name, (args as { op?: string }).op);
      assert(resolved);
      return question(name, resolved.route, args);
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

const GROUP = id("qgr", 1);
const QUESTION = id("qst", 1);

// 질문 하나짜리 묶음을 agent의 run이 낸다.
async function createGroup(
  opened: Opened,
  options: unknown[],
  group = GROUP,
  question = QUESTION,
) {
  await ok(opened, "questions/create", {
    id: group,
    run: RUN,
    session: null,
    expires_at: null,
    questions: [{
      id: question,
      prompt: "Which one?",
      reason: "Both are fine.",
      options,
      recommendation: null,
    }],
  }, AGENT_TOKEN);
}

type GroupView =
  & { state: string; created_seq: string }
  & Record<
    string,
    unknown
  >;
const groupOf = (reply: { structuredContent: { data: unknown } }) =>
  (reply.structuredContent.data as { group: GroupView }).group;

Deno.test("coding-agent/mcp-server#R18: 실제 core의 대기 질문 묶음을 이유·option과 결정 화면 링크로 읽고 답 op는 닫혀 있다", async () => {
  const opened = await open();
  try {
    await startRun(opened);
    await createGroup(opened, [{
      key: "a",
      label: "Option a",
      description: "The first one.",
      evidence: [],
      adoption: null,
      action: null,
    }]);
    const { call } = coding(opened);
    const shown = await call("lophn_question", { op: "show", group: GROUP });
    assertEquals(shown.isError, undefined, JSON.stringify(shown));
    const record = groupOf(shown);
    assertEquals(record.state, "waiting");
    assertEquals(record.decision_link, `lophn://things-to-confirm/${GROUP}`);
    const asked = (record.questions as Record<string, unknown>[])[0];
    assertEquals(asked.reason_blob, sha256Text("Both are fine."));
    assertEquals((asked.options as { key: string }[])[0].key, "a");
    const listed = await call("lophn_question", {
      op: "list",
      status: "pending",
    });
    assertEquals(listed.isError, undefined);
    assertEquals(listed.structuredContent.summary, "질문 묶음 1개, 대기 1개");
    // answer op는 tool 표에 없다. coding credential의 직접 요청도 core가 거절한다.
    const answer = await call("lophn_question", {
      op: "answer",
      group: GROUP,
    });
    assertEquals(answer.isError, true);
    const direct = await post(
      opened,
      "questions/answer",
      {
        group: GROUP,
        created_seq: String(record.created_seq),
        answers: [{
          question: QUESTION,
          answer: { kind: "text", text: "Use the first one." },
        }],
      },
      CODING_TOKEN,
      { created_seq: String(record.created_seq) },
    );
    assertEquals(direct.status, 403, JSON.stringify(direct.body));
    // 거절 뒤에도 묶음은 그대로 대기다.
    const after = await call("lophn_question", { op: "show", group: GROUP });
    assertEquals(groupOf(after).state, "waiting");
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R18: 없는 질문 묶음은 isError로 응답에 닿는다", async () => {
  const opened = await open();
  try {
    const { call } = coding(opened);
    const missing = await call("lophn_question", {
      op: "show",
      group: id("qgr", 9),
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
    await createGroup(opened, []);
    const { call } = coding(opened);
    const shown = await call("lophn_question", { op: "show", group: GROUP });
    const createdSeq = String(groupOf(shown).created_seq);
    const attempts: [string, unknown, unknown][] = [
      ["questions/defer", { group: GROUP, created_seq: createdSeq }, {
        created_seq: createdSeq,
      }],
      ["questions/cancel", {
        group: GROUP,
        created_seq: createdSeq,
        closed_reason: "cancelled",
        closed_reason_text: "No longer needed.",
      }, { created_seq: createdSeq }],
      ["questions/apply-option", {
        question: QUESTION,
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
    const after = await call("lophn_question", { op: "show", group: GROUP });
    assertEquals(groupOf(after).state, "waiting");
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R18: 사람이 미룬 질문 묶음은 대기가 아니라 미룸으로 읽히고 대기 목록에서 빠진다", async () => {
  const opened = await open();
  try {
    await startRun(opened);
    await createGroup(opened, []);
    const { call } = coding(opened);
    const shown = await call("lophn_question", { op: "show", group: GROUP });
    const createdSeq = String(groupOf(shown).created_seq);
    await ok(
      opened,
      "questions/defer",
      { group: GROUP, created_seq: createdSeq },
      USER_TOKEN,
      { created_seq: createdSeq },
    );
    const deferred = await call("lophn_question", { op: "show", group: GROUP });
    const record = groupOf(deferred);
    assertEquals(record.state, "deferred");
    assertEquals(record.decision_link, null);
    const waiting = await call("lophn_question", {
      op: "list",
      status: "pending",
    });
    assertEquals(
      waiting.structuredContent.summary,
      "질문 묶음 0개, 대기 0개",
    );
    const all = await call("lophn_question", { op: "list" });
    assertEquals(all.structuredContent.summary, "질문 묶음 1개, 대기 0개");
  } finally {
    await opened.dispose();
  }
});
