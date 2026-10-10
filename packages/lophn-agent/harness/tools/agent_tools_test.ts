import { assert, assertEquals } from "@std/assert";
import type { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  applyOperatorAssignmentInputSchema,
  operatorApprovalBundleSchema,
  ROUTES,
} from "../../../contracts/lophn-agent/mod.ts";
import { approvalsGet } from "../../../contracts/platform/mod.ts";
import {
  AGENT_TOOLS,
  type AgentToolPorts,
  BUILTIN_TOOLS,
  createAgentToolHandlers,
  executeTool,
  listTools,
  type RunCredential,
} from "./mod.ts";

// agent 일 tool 묶음(question·approval·preset·assignment·run·handoff)의 정의와 handler를 본다.
// 실제 core를 거친 handoff 계보는 apps/core/handoff_test.ts가 본다.

const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const MSG = "msg_01arz3ndektsv4rrffq69g5fav";
const ASG = "asg_01arz3ndektsv4rrffq69g5fbw";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const VER = "ver_01arz3ndektsv4rrffq69g5fav";

type Call = { contract: string; input: unknown; run: string };

function ports(
  calls: Call[],
  facts: { original_message: string | null } = { original_message: MSG },
): AgentToolPorts {
  let counter = 0;
  return {
    call: (contract, input, run) => {
      calls.push({ contract, input, run });
      return Promise.resolve(ok({ as_of_seq: "1", next_cursor: null }));
    },
    newId: (prefix) => {
      counter += 1;
      return `${prefix}_01arz3ndektsv4rrffq69g5f${"abcdefgh"[counter]}${"a"}`;
    },
    runFacts: () =>
      Promise.resolve(ok({
        session: null,
        role: "lophn" as const,
        original_message: facts.original_message,
        assignment: ASG,
      })),
  };
}

function credential(contracts: readonly string[]): RunCredential {
  return {
    run: RUN,
    targets: new Set(),
    operations: new Set(contracts),
  };
}

function listedAll() {
  const names = AGENT_TOOLS.map((tool) => tool.name);
  return listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    { presetTools: names, roleTools: names },
  );
}

Deno.test("lophn-agent/harness/tools#R10: preset·assignment tool은 읽기만 있고 소유 contract의 변경 command를 부르는 tool이 없다", () => {
  const owned = AGENT_TOOLS.filter((tool) =>
    tool.name.startsWith("preset.") || tool.name.startsWith("assignment.")
  );
  assertEquals(owned.map((tool) => tool.name).sort(), [
    "assignment.list",
    "assignment.read",
    "preset.list",
    "preset.read",
  ]);
  for (const tool of owned) {
    assertEquals(tool.effect, "read", tool.name);
    assertEquals(tool.confirm, false, tool.name);
  }
  // 어떤 tool도 preset·assignment·run ledger의 변경 command를 소유 contract로 갖지 않는다.
  const mutating = new Set(
    ROUTES.filter((route) =>
      route.kind === "command" &&
      ["presets", "assignments", "assignment-occurrences", "runs"].includes(
        route.resource,
      )
    ).map((route) => route.name),
  );
  assert(mutating.size > 0);
  for (const tool of AGENT_TOOLS) {
    assert(!mutating.has(tool.contract), `${tool.name} → ${tool.contract}`);
  }
  // 읽기 tool은 소유 contract의 읽기 route를 가리킨다.
  const reads = new Set(
    [...ROUTES, approvalsGet].filter((route) => route.kind === "read").map((
      route,
    ) => route.name),
  );
  for (const tool of AGENT_TOOLS.filter((tool) => tool.effect === "read")) {
    assert(reads.has(tool.contract), `${tool.name} → ${tool.contract}`);
  }
  // 적용·변경 동작은 이름 자체가 없어 실행기가 소유 contract를 부르기 전에 없는 tool로 답한다.
  const calls: Call[] = [];
  const names = [
    "preset.create",
    "preset.revise",
    "assignment.create",
    "assignment.apply",
    "assignment.pause",
    "assignment.change_preset",
  ];
  for (const name of names) {
    assertEquals(listedAll().some((tool) => tool.name === name), false, name);
  }
  return Promise.all(names.map(async (name) => {
    const outcome = await executeTool(
      {
        listed: listedAll(),
        handlers: createAgentToolHandlers(ports(calls)),
        credential: credential(["CreateAssignment", "ApplyOperatorAssignment"]),
      },
      name,
      { assignment: ASG },
    );
    assertEquals(outcome.executed, false, name);
    assertEquals(outcome.outcome.code, "not_found", name);
  })).then(() => assertEquals(calls, []));
});

Deno.test("lophn-agent/harness/tools#R10: 읽기 tool은 소유 읽기 contract 하나만 부르고 입력의 모르는 필드는 소유 contract에 닿기 전에 거절한다", async () => {
  const calls: Call[] = [];
  const deps = {
    listed: listedAll(),
    handlers: createAgentToolHandlers(ports(calls)),
    credential: credential(["ListAssignments", "ReadAssignment"]),
  };
  const listed = await executeTool(deps, "assignment.list", { role: "lophn" });
  assertEquals(listed.outcome.kind, "success");
  assertEquals(calls, [{
    contract: "ListAssignments",
    input: { role: "lophn" },
    run: RUN,
  }]);
  // 직접 적용을 흉내 내는 필드는 정의에 없어 invalid_input이다.
  const smuggled = await executeTool(deps, "assignment.read", {
    assignment: ASG,
    apply: true,
  });
  assertEquals(smuggled.outcome.code, "invalid_input");
  assertEquals(calls.length, 1);
  // 현재 run scope에 contract 권한이 없으면 없는 tool과 같다.
  const noScope = await executeTool(
    { ...deps, credential: credential([]) },
    "assignment.list",
    {},
  );
  assertEquals(noScope.outcome.code, "not_found");
  assertEquals(calls.length, 1);
});

Deno.test("lophn-agent/handoff#R3: handoff.submit tool은 호출 run의 사실로 보낸 역할·원래 사람 요청·내용 hash를 채우고 모델이 정하는 필드는 설명·근거·대상뿐이다", async () => {
  const calls: Call[] = [];
  const deps = {
    listed: listedAll(),
    handlers: createAgentToolHandlers(ports(calls)),
    credential: credential(["SubmitHandoff"]),
  };
  const input = {
    receiver_assignment: ASG,
    to_role: "context_engineer",
    what: "정리한다",
    why: "요청이다",
    excludes: [],
    expected_outputs: ["context"],
    references: [{
      document: DOC,
      version: VER,
      section: null,
      question: null,
    }],
    dedup_key: "once",
  };
  const sent = await executeTool(deps, "handoff.submit", input);
  assertEquals(sent.outcome.kind, "success");
  assertEquals(calls.length, 1);
  const submitted = calls[0]!.input as Record<string, unknown>;
  assertEquals(calls[0]!.contract, "SubmitHandoff");
  assertEquals(submitted["sender_run"], RUN);
  assertEquals(submitted["from_role"], "lophn");
  assertEquals(submitted["original_message"], MSG);
  assertEquals(submitted["dedup_key"], "once");
  assertEquals(
    (submitted["body"] as string).length,
    64,
  );
  // 보낸 run·원래 요청·수신 run을 모델이 정하는 입력은 거절한다.
  for (
    const over of [
      { sender_run: RUN },
      { original_message: MSG },
      { receiver_run: RUN },
      { from_role: "operator" },
      { body: "a".repeat(64) },
    ]
  ) {
    const refused = await executeTool(deps, "handoff.submit", {
      ...input,
      ...over,
    });
    assertEquals(refused.outcome.code, "invalid_input");
  }
  assertEquals(calls.length, 1);
});

Deno.test("lophn-agent/handoff#R5: 원래 사람 요청이 없는 run의 handoff.submit은 소유 contract를 부르지 않는다", async () => {
  const calls: Call[] = [];
  const outcome = await executeTool(
    {
      listed: listedAll(),
      handlers: createAgentToolHandlers(
        ports(calls, { original_message: null }),
      ),
      credential: credential(["SubmitHandoff"]),
    },
    "handoff.submit",
    {
      receiver_assignment: ASG,
      to_role: "lophn",
      what: "맡긴다",
      why: "이유",
      excludes: [],
      expected_outputs: ["결과"],
      references: [{
        document: DOC,
        version: VER,
        section: null,
        question: null,
      }],
      dedup_key: "periodic",
    },
  );
  assertEquals(outcome.outcome.kind, "failure");
  assertEquals(calls, []);
});

Deno.test("lophn-agent/handoff#R9: handoff 현황 tool은 호출 run을 보낸 run으로 묻고 결과 tool은 받는 run 하나만 묻는다", async () => {
  const calls: Call[] = [];
  const deps = {
    listed: listedAll(),
    handlers: createAgentToolHandlers(ports(calls)),
    credential: credential(["ReadHandoffStatus", "ReadHandoffResult"]),
  };
  assertEquals(
    (await executeTool(deps, "handoff.read_status", { dedup_key: "once" }))
      .outcome.kind,
    "success",
  );
  assertEquals(calls[0], {
    contract: "ReadHandoffStatus",
    input: { sender_run: RUN, dedup_key: "once" },
    run: RUN,
  });
  const result = await executeTool(deps, "handoff.read_result", {
    receiver_run: "run_01arz3ndektsv4rrffq69g5fbw",
  });
  assertEquals(result.outcome.kind, "success");
  assertEquals(calls[1]?.contract, "ReadHandoffResult");
});

Deno.test("lophn-agent/harness/tools#R2: question.submit tool은 호출 run의 세션과 새 질문 ID로 CreateQuestion 하나를 부르고 선택지의 고정 action은 모델이 싣지 못한다", async () => {
  const calls: Call[] = [];
  const deps = {
    listed: listedAll(),
    handlers: createAgentToolHandlers(ports(calls)),
    credential: credential(["CreateQuestion"]),
  };
  const input = {
    prompt: "어느 쪽으로 갈까요",
    reason: "취향이 갈린다",
    options: [],
    recommendation: null,
    expires_at: null,
  };
  const asked = await executeTool(deps, "question.submit", input);
  assertEquals(asked.outcome.kind, "success");
  const created = calls[0]!.input as Record<string, unknown>;
  assertEquals(calls[0]!.contract, "CreateQuestion");
  assertEquals(created["run"], RUN);
  assertEquals(created["session"], null);
  assert(/^qst_/.test(String(created["id"])));
  const withAction = await executeTool(deps, "question.submit", {
    ...input,
    options: [{
      key: "a",
      label: "A",
      description: "A",
      evidence: [],
      adoption: null,
      action: { concern: "platform/settings", command: "apply_settings" },
    }],
  });
  assertEquals(withAction.outcome.code, "invalid_input");
  assertEquals(calls.length, 1);
});

Deno.test("documents/terms#R2 lophn-agent/questions#R13: question.submit은 읽은 후보의 이름·revision으로 term.define을 고정하고 모델의 action 객체는 거절한다", async () => {
  const TERM = "trm_01arz3ndektsv4rrffq69g5fav";
  const calls: {
    contract: string;
    input: unknown;
    options?: { idempotency_key?: string };
  }[] = [];
  const term = {
    id: TERM,
    context: "ctx_01arz3ndektsv4rrffq69g5fav",
    name: "정산주기",
    definition: null as string | null,
    revision: "7",
    status: "active",
  };
  const handlers = createAgentToolHandlers({
    ...ports([]),
    call: (contract, input, _run, options) => {
      calls.push({ contract, input, options });
      if (contract === "term.get") return Promise.resolve(ok({ term }));
      return Promise.resolve(ok({ id: "qst_x", status: "pending" }));
    },
  });
  const listed = listedAll();
  const ask = {
    prompt: "정산주기의 뜻을 이 글로 고정할까요",
    reason: "후보 이름과 이 뜻을 선택지에 고정했다",
    recommendation: null,
    expires_at: null,
  };
  const fixed = await executeTool(
    {
      listed,
      handlers,
      credential: { ...credential(["CreateQuestion"]), call: "tcl_fix" },
    },
    "question.submit",
    {
      ...ask,
      options: [{
        key: "use",
        label: "정산주기",
        description: "한 달이 끝나는 날 맞추는 계산",
        evidence: [],
        adoption: null,
        action: null,
        term_definition: {
          term: TERM,
          name: "정산주기",
          definition: "한 달이 끝나는 날 맞추는 계산",
        },
      }, {
        key: "leave",
        label: "지금은 정하지 않는다",
        description: "이 선택지는 뜻을 고정하지 않는다",
        evidence: [],
        adoption: null,
        action: null,
      }],
    },
  );
  assertEquals(fixed.outcome.kind, "success", JSON.stringify(fixed.result));
  const created = calls.find((call) => call.contract === "CreateQuestion");
  assert(created !== undefined);
  assertEquals(created.options?.idempotency_key, "tcl_fix");
  const options = (created.input as { options: Record<string, unknown>[] })
    .options;
  assertEquals("term_definition" in options[0]!, false);
  assertEquals(options[1]!["action"], null);
  const action = options[0]!["action"] as {
    command: string;
    targets: string[];
    input: { kind: string; value: Record<string, unknown> };
    comparison: { base_revision: string };
  };
  assertEquals(action.command, "term.define");
  assertEquals(action.targets, [TERM]);
  assertEquals(action.input.kind, "inline");
  assertEquals(action.input.value, {
    term: TERM,
    name: "정산주기",
    definition: "한 달이 끝나는 날 맞추는 계산",
  });
  assertEquals(action.comparison.base_revision, "7");
  calls.length = 0;
  term.definition = "이미 있는 뜻";
  const defined = await executeTool(
    { listed, handlers, credential: credential(["CreateQuestion"]) },
    "question.submit",
    {
      ...ask,
      options: [{
        key: "use",
        label: "정산주기",
        description: "다른 뜻",
        evidence: [],
        adoption: null,
        action: null,
        term_definition: {
          term: TERM,
          name: "정산주기",
          definition: "다른 뜻",
        },
      }],
    },
  );
  assertEquals(defined.outcome.code, "invalid_input");
  assertEquals(calls.some((call) => call.contract === "CreateQuestion"), false);
  term.definition = null;
  const renamed = await executeTool(
    { listed, handlers, credential: credential(["CreateQuestion"]) },
    "question.submit",
    {
      ...ask,
      options: [{
        key: "use",
        label: "다른 이름",
        description: "다른 뜻",
        evidence: [],
        adoption: null,
        action: null,
        term_definition: {
          term: TERM,
          name: "다른 이름",
          definition: "다른 뜻",
        },
      }],
    },
  );
  assertEquals(renamed.outcome.code, "invalid_input");
  assertEquals(calls.some((call) => call.contract === "CreateQuestion"), false);
});

Deno.test("apps/registration#R3 lophn-agent/questions#R13: question.submit은 등록 제안으로 app.create를 고정하고 근거 판 하나가 등록 근거가 되며 미리 배정한 앱 ID가 대상이다", async () => {
  const calls: Call[] = [];
  const handlers = createAgentToolHandlers({
    ...ports([]),
    call: (contract, input) => {
      calls.push({ contract, input, run: RUN });
      return Promise.resolve(ok({ id: "qst_x", status: "pending" }));
    },
  });
  const deps = {
    listed: listedAll(),
    handlers,
    credential: credential(["CreateQuestion"]),
  };
  const ref = { document: DOC, version: VER, section: null };
  const ask = {
    prompt: "이 계획으로 앱을 등록할까요",
    reason: "등록은 채택과 별개 결정이다",
    recommendation: null,
    expires_at: null,
  };
  const registration = {
    slug: "household-ledger",
    name: "Spending",
    description: "It records each spend and shows the month total.",
  };
  const option = {
    key: "register",
    label: "Register",
    description: "slug household-ledger",
    evidence: [ref],
    adoption: null,
    action: null,
    app_registration: registration,
  };
  const fixed = await executeTool(deps, "question.submit", {
    ...ask,
    options: [option, {
      key: "skip",
      label: "Do not register",
      description: "Leave it.",
      evidence: [],
      adoption: null,
      action: null,
    }],
  });
  assertEquals(fixed.outcome.kind, "success", JSON.stringify(fixed.result));
  const options = (calls[0]!.input as { options: Record<string, unknown>[] })
    .options;
  assertEquals("app_registration" in options[0]!, false);
  assertEquals(options[1]!["action"], null);
  const action = options[0]!["action"] as {
    concern: string;
    command: string;
    targets: string[];
    input: { value: Record<string, unknown> };
    comparison: Record<string, unknown>;
  };
  assertEquals(action.concern, "apps/registration");
  assertEquals(action.command, "app.create");
  assert(/^app_/.test(action.targets[0]!));
  assertEquals(action.input.value, {
    id: action.targets[0],
    ...registration,
    planning_version: VER,
  });
  assertEquals(action.comparison, {});
  calls.length = 0;
  // 근거 판이 하나가 아니거나 후보 정의와 같이 오면 질문을 만들지 않는다.
  for (
    const bad of [
      { ...option, evidence: [] },
      {
        ...option,
        evidence: [ref, { ...ref, version: VER.replace("av", "aw") }],
      },
      {
        ...option,
        term_definition: {
          term: "trm_01arz3ndektsv4rrffq69g5fav",
          name: "x",
          definition: "y",
        },
      },
    ]
  ) {
    const rejected = await executeTool(deps, "question.submit", {
      ...ask,
      options: [bad],
    });
    assertEquals(rejected.outcome.code, "invalid_input");
  }
  assertEquals(calls.length, 0);
});

Deno.test("lophn-agent/harness/tools#R12: 소유 contract가 거절한 오류 문장은 대상의 존재를 새지 않는다", async () => {
  const failing: AgentToolPorts = {
    ...ports([]),
    call: (): Promise<Result<unknown>> =>
      Promise.resolve(err({ code: "not_found", message: `no ${ASG}` })),
  };
  const outcome = await executeTool(
    {
      listed: listedAll(),
      handlers: createAgentToolHandlers(failing),
      credential: credential(["ReadAssignment"]),
    },
    "assignment.read",
    { assignment: ASG },
  );
  assertEquals(outcome.outcome.code, "not_found");
  assertEquals(outcome.result.summary.includes(ASG), false);
});

// 승인에 묶일 bundle 초안이다. 모델은 bundle 모양 그대로만 쓰고 id·요청자·run·기한은
// handler가 채운다(P9, assignments#R4).
function bundle(
  over: Partial<z.infer<typeof operatorApprovalBundleSchema>> = {},
): z.infer<typeof operatorApprovalBundleSchema> {
  return operatorApprovalBundleSchema.parse({
    draft_version: VER,
    assignment: null,
    expected_assignment_revision: null,
    preset: "pst_01arz3ndektsv4rrffq69g5fav",
    preset_revision: 1,
    preset_definition: "a".repeat(64),
    scope: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" },
    outputs: [{ document: DOC, content: "주간 변화" }],
    read_apps: [],
    read_commands: [],
    schedule: {
      first_at: "2026-02-01T00:00:00.000Z",
      every_ms: 3_600_000,
    },
    reason: "watch 변화가 반복된다",
    ...over,
  });
}

Deno.test("lophn-agent/harness/tools#R4: approval.submit_assignment는 create_approval_request 하나에 정확한 action을 싣고 대리 결정·직접 apply는 없다", async () => {
  const calls: Call[] = [];
  const deps = {
    listed: listedAll(),
    handlers: createAgentToolHandlers(ports(calls)),
    credential: credential(["create_approval_request"]),
  };
  const sent = await executeTool(
    deps,
    "approval.submit_assignment",
    bundle(),
  );
  assertEquals(sent.outcome.kind, "success");
  assertEquals(calls.length, 1);
  assertEquals(calls[0]!.contract, "create_approval_request");
  const created = calls[0]!.input as Record<string, unknown>;
  // id·요청자·run·기한은 모델이 정하지 않는다(P9).
  const aprId = String(created["id"]);
  assert(/^apr_/.test(aprId));
  assertEquals(created["requester"], `agent:${ASG}`);
  assertEquals(created["run"], RUN);
  assertEquals(created["expires_at"], null);
  assertEquals(created["reason"], "watch 변화가 반복된다");
  // action은 적용 command 하나에 묶인다(lophn-agent#T53의 입력 모양 맞춤).
  const action = created["action"] as Record<string, unknown>;
  assertEquals(action["concern"], "lophn-agent/assignments");
  assertEquals(action["command"], "ApplyOperatorAssignment");
  assertEquals(action["caller"], `agent:${ASG}`);
  // 대상은 승인이 묶을 assignment 하나다: creating 초안은 새로 만들 id다.
  assertEquals(
    (action["targets"] as string[])[0],
    applyInputValue(action)["id"],
  );
  assert(action["binding_hash"] !== action["input_hash"]);
  // 입력은 apply가 받는 모양 그대로다(lophn-agent#T53): 접수 필드
  // (approval·id)를 handler가 채우고, 결정 seq는 허락이 확정하는 것이라 생략하고
  // apply handler가 승인 기록으로 맞춘다. 초안 번들은 사람이 검토한 모양 그대로다.
  const applyInput = applyInputValue(action);
  assertEquals(applyInput["approval"], aprId);
  assertEquals("decision_seq" in applyInput, false);
  assertEquals(applyInput["bundle"], bundle());
  // action.input.value는 apply contract의 입력 schema를 그대로 통과한다.
  assert(
    applyOperatorAssignmentInputSchema.safeParse(applyInput).success,
  );
});

function applyInputValue(
  action: Record<string, unknown>,
): Record<string, unknown> {
  return (action["input"] as { value: Record<string, unknown> })["value"]!;
}

Deno.test("lophn-agent/harness/tools#R4: 같은 bundle 초안은 같은 binding hash를 내고 정의 밖 자유 입력은 거절된다", async () => {
  const calls: Call[] = [];
  const deps = {
    listed: listedAll(),
    handlers: createAgentToolHandlers(ports(calls)),
    credential: credential(["create_approval_request"]),
  };
  const first = await executeTool(deps, "approval.submit_assignment", bundle());
  assertEquals(first.outcome.kind, "success");
  const hashOne =
    (calls[0]!.input as Record<string, unknown>)["action"] as Record<
      string,
      unknown
    >;
  const second = await executeTool(
    deps,
    "approval.submit_assignment",
    bundle(),
  );
  assertEquals(second.outcome.kind, "success");
  const hashTwo =
    (calls[1]!.input as Record<string, unknown>)["action"] as Record<
      string,
      unknown
    >;
  assertEquals(hashOne["binding_hash"], hashTwo["binding_hash"]);
  assertEquals(hashOne["input_hash"], hashTwo["input_hash"]);
  assertEquals(calls.length, 2);
  // 정의 schema가 거절하는 자유 입력은 소유 contract에 닿기 전에 막힌다.
  const smuggled = await executeTool(deps, "approval.submit_assignment", {
    ...bundle(),
    tool: "doc.write",
  });
  assertEquals(smuggled.outcome.code, "invalid_input");
  // 비어 있는 이유는 bundle 모양이 거절한다. parse가 아니라 실행 입력으로 거절된다.
  const raw = { ...bundle(), reason: " " };
  const blank = await executeTool(
    deps,
    "approval.submit_assignment",
    raw as unknown,
  );
  assertEquals(blank.outcome.code, "invalid_input");
  assertEquals(calls.length, 2);
});
