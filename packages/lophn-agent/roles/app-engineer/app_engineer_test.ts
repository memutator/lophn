import { assert, assertEquals } from "@std/assert";
import {
  handoffAllowed,
  handoffContentSchema,
  handoffReferenceSchema,
  questionOptionSchema,
  runSourceSchema,
  saveToolDocumentInputSchema,
} from "@lophn/contracts/lophn-agent";
import type { CatalogEntry } from "@lophn/contracts/lophn-agent";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  BUILTIN_TOOLS,
  createBuiltinToolHandlers,
  executeTool,
  listTools,
  type RunCredential,
  runOperations,
  TOOL_BUNDLES,
} from "../../harness/tools/mod.ts";
import {
  productPresetDefinition,
  ROLE_CAPS,
  validateDefinition,
  type ValidateDeps,
} from "../../presets/mod.ts";
import {
  ASSUMPTION_MAX,
  canStartStep,
  checkChoiceQuestion,
  checkContractRequest,
  checkReadBack,
  checkSpec,
  checkStepBasis,
  type ChoiceQuestion,
  type ContractRequest,
  decisionOwner,
  DESIGN_DOCUMENT_KINDS,
  DESIGN_DOCUMENT_TITLES,
  DESIGN_MEDIA_TYPE,
  DESIGN_STEPS,
  implementationChoices,
  INTERVIEW_QUESTION_MAX,
  interviewBasis,
  mayStart,
  nextDesignStep,
  nextInterviewStep,
  planDesignSaves,
  purposeOf,
  type ReadDecision,
  readDecision,
  type ReadScope,
  routeDecision,
  SPEC_FLOW_STEP_MAX,
  type SpecDraft,
  splitFlow,
  type StepResult,
  ticketDecision,
} from "./mod.ts";

// roles/app-engineer의 인터뷰·설계 문서·읽기 범위 규칙(순수 규칙)과 문서 저장 흐름을
// 본다. tool 선택과 앱 command 범위는 app_engineer_tools_test.ts가 본다. 실제 provider와
// 사람 데이터 root는 열지 않는다(model 호출이 없는 규칙이다).

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const APP = id("app", 1);
const OTHER_APP = id("app", 2);
const RUN = id("run", 1);
const OTHER_RUN = id("run", 2);
const CALL = id("tcl", 1);
const STORY = id("doc", 1);
const STORY_V1 = id("ver", 1);
const STORY_V2 = id("ver", 2);
const MODEL = id("doc", 2);
const MODEL_V1 = id("ver", 3);
const PLAN = id("doc", 3);
const PLAN_V1 = id("ver", 4);
const HASH = "a".repeat(64);

// --- R1: 사람 요청과 handoff로만 시작한다 ---------------------------------------

Deno.test("lophn-agent/roles/app-engineer#R1: 사람 요청과 그 요청을 잇는 handoff만 App Engineer를 시작한다", () => {
  assertEquals(mayStart({ kind: "message", message: id("msg", 1) }), true);
  assertEquals(
    mayStart({
      kind: "handoff",
      sender_run: OTHER_RUN,
      original_message: id("msg", 1),
      body: HASH,
      references: [],
      dedup_key: "key-1",
    }),
    true,
  );
  // 주기 회차는 operator의 것이고, 문제 발생·release activation은 시작 계기가 아니다.
  assertEquals(
    mayStart({
      kind: "schedule",
      assignment_revision: 1,
      scheduled_at: "2026-01-01T00:00:00.000Z",
    }),
    false,
  );
  for (
    const kind of ["problem_opened", "release_activated", "ticket_changed"]
  ) {
    assertEquals(mayStart({ kind }), false, kind);
  }
});

Deno.test("lophn-agent/roles/app-engineer#R1: 문제·release 변화는 run 출처가 아니고 AE에는 주기 tool이 없다", () => {
  for (
    const source of [
      { kind: "problem_opened", problem: id("prb", 1) },
      { kind: "release_activated", release: id("rel", 1) },
    ]
  ) {
    assertEquals(runSourceSchema.safeParse(source).success, false, source.kind);
  }
  const cap = ROLE_CAPS.get("app_engineer")!;
  assertEquals(
    cap.tools.filter((tool) =>
      tool.startsWith("schedule.") || tool.includes("subscribe")
    ),
    [],
  );
});

// --- R2: 읽기 범위 ---------------------------------------------------------------

function scope(over: Partial<ReadScope> = {}): ReadScope {
  return {
    app: APP,
    run: RUN,
    contexts: [
      { id: id("ctx", 1), app_data: [{ app: APP, command: "read_items" }] },
      {
        id: id("ctx", 2),
        app_data: [{ app: OTHER_APP, command: "read_other" }],
      },
    ],
    handoff: [{ run: RUN, document: PLAN, version: PLAN_V1 }],
    ...over,
  };
}

Deno.test("lophn-agent/roles/app-engineer#R2: 담당 앱 자리의 자료와 제품 SDK 계약은 읽는다", () => {
  const own = { kind: "app" as const, id: APP };
  assertEquals(
    readDecision(scope(), { kind: "place_material", place: own }),
    { allowed: true, via: "own_app" },
  );
  assertEquals(
    readDecision(scope(), {
      kind: "document",
      document: STORY,
      version: null,
      place: own,
    }),
    { allowed: true, via: "own_app" },
  );
  assertEquals(
    readDecision(scope(), { kind: "sdk_contract" }),
    { allowed: true, via: "sdk_contract" },
  );
  // 다른 앱·project·전역 자리의 자료는 없는 것과 같다.
  for (
    const place of [
      { kind: "app" as const, id: OTHER_APP },
      { kind: "project" as const, id: id("prj", 1) },
      { kind: "global" as const, id: null },
    ]
  ) {
    assertEquals(readDecision(scope(), { kind: "place_material", place }), {
      allowed: false,
      code: "not_found",
    });
  }
});

Deno.test("lophn-agent/roles/app-engineer#R2: 컨텍스트는 담당 앱의 읽기 명령을 app-data source로 가질 때만 읽고 그 컨텍스트의 다른 자리 문서는 주소로 열지 못한다", () => {
  assertEquals(
    readDecision(scope(), { kind: "context", context: id("ctx", 1) }),
    { allowed: true, via: "context" },
  );
  // 다른 앱의 명령만 source로 가진 컨텍스트와 없는 컨텍스트는 같은 결과다.
  const denied: ReadDecision = { allowed: false, code: "not_found" };
  assertEquals(
    readDecision(scope(), { kind: "context", context: id("ctx", 2) }),
    denied,
  );
  assertEquals(
    readDecision(scope(), { kind: "context", context: id("ctx", 9) }),
    denied,
  );
  // 허용된 컨텍스트의 다른 자리 문서와 다른 컨텍스트의 문서는 주소만으로 열리지 않는다.
  assertEquals(
    readDecision(scope(), {
      kind: "document",
      document: STORY,
      version: STORY_V1,
      place: { kind: "project", id: id("prj", 1) },
    }),
    denied,
  );
  assertEquals(
    readDecision(scope(), {
      kind: "document",
      document: id("doc", 9),
      version: null,
      place: null,
    }),
    denied,
  );
});

Deno.test("lophn-agent/roles/app-engineer#R2: handoff 고정 판은 그 run 동안 읽지만 최신 판과 다른 run의 근거는 열지 못한다", () => {
  const request = (version: string | null) => ({
    kind: "document" as const,
    document: PLAN,
    version,
    place: { kind: "project" as const, id: id("prj", 1) },
  });
  assertEquals(
    readDecision(scope(), request(PLAN_V1)),
    { allowed: true, via: "handoff_evidence" },
  );
  const denied: ReadDecision = { allowed: false, code: "not_found" };
  // 최신 판은 주소만으로 열지 못한다(version 지정 없음, 다른 version).
  assertEquals(readDecision(scope(), request(null)), denied);
  assertEquals(readDecision(scope(), request(id("ver", 20))), denied);
  // 같은 근거도 다른 run에서는 열지 못한다.
  assertEquals(
    readDecision(scope({ run: OTHER_RUN }), request(PLAN_V1)),
    denied,
  );
  // 고정 판은 그 문서만 연다: 다른 문서의 고정 판은 닫혀 있다.
  assertEquals(
    readDecision(scope(), {
      kind: "document",
      document: STORY,
      version: PLAN_V1,
      place: null,
    }),
    denied,
  );
});

Deno.test("lophn-agent/roles/app-engineer#R2: AE 기본 preset은 담당 assignment 범위만 읽는다", () => {
  const preset = productPresetDefinition("app_engineer", HASH);
  assertEquals(preset.context, [{
    kind: "assignment_scope",
    target: null,
    section: null,
  }]);
});

// --- R3: 맡지 않는 일 ----------------------------------------------------------

const NOT_OWNED_TOOLS = [
  // 코드·테스트·빌드·미리보기.
  "code.write",
  "code.edit",
  "code.run",
  "test.run",
  "build.run",
  "preview.start",
  "shell.exec",
  // 앱 채택·전체 재사용·컨텍스트 적용.
  "app.create",
  "app.adopt",
  "sdk.plan_reuse",
  "context.apply",
  "term.define",
  // 앱 command 계약 밖 운영과 Operator 업무.
  "app.run",
  "operator.create",
  "assignment.create",
  // 문제 상태 변경.
  "problem.close",
  "problem.claim",
  "problem.resolve",
  "problem.update_state",
];

function rig() {
  const calls: string[] = [];
  const cap = ROLE_CAPS.get("app_engineer")!;
  const listed = listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    { presetTools: cap.tools, roleTools: cap.tools },
  );
  const handlers = createBuiltinToolHandlers({
    call: (contract: string): Promise<Result<unknown>> => {
      calls.push(contract);
      return Promise.resolve(err({ code: "not_found", message: contract }));
    },
    newId: () => id("qst", 9),
    runFacts: () =>
      Promise.resolve(ok({
        session: null,
        role: "app_engineer" as const,
        original_message: id("msg", 1),
        assignment: id("asg", 1),
      })),
  });
  const operations = new Set(runOperations(listed));
  const run = (tool: string, input: unknown) => {
    const credential: RunCredential = {
      run: RUN,
      targets: new Set(),
      operations,
      call: CALL,
    };
    return executeTool({ listed, handlers, credential }, tool, input);
  };
  return { calls, listed, run };
}

Deno.test("lophn-agent/roles/app-engineer#R3: 코드·테스트·채택·문제 상태 변경 tool은 상한과 내장 정의 어디에도 없다", async () => {
  const cap = ROLE_CAPS.get("app_engineer")!;
  const { listed, run, calls } = rig();
  const builtin = new Set(BUILTIN_TOOLS.map((tool) => tool.name));
  const listedNames = new Set(listed.map((tool) => tool.name));
  for (const name of NOT_OWNED_TOOLS) {
    assert(!cap.tools.includes(name), `${name} in role cap`);
    assert(!listedNames.has(name), `${name} listed`);
    assert(!builtin.has(name), `${name} builtin`);
  }
  // 목록에 없는 tool의 실행은 없는 tool과 같은 결과이고 소유 contract까지 가지 않는다.
  for (const name of NOT_OWNED_TOOLS) {
    const outcome = await run(name, {});
    assertEquals(outcome.outcome.kind, "failure", name);
    assertEquals(outcome.outcome.code, "not_found", name);
  }
  assertEquals(calls, []);
});

Deno.test("lophn-agent/roles/app-engineer#R3: 산출물은 설계·해석 문서뿐이고 test result·problem 닫힘은 문서 종류가 아니다", () => {
  const plan = planDesignSaves([
    "spec",
    "interpretation",
    "test_result",
    "problem_closed",
    "code_patch",
  ]);
  assertEquals(plan.save, ["spec", "interpretation"]);
  assertEquals(plan.unknown, ["test_result", "problem_closed", "code_patch"]);
});

// --- R4: lophn 기획에서 시작하고 다른 역할의 결정은 넘긴다 ------------------------

Deno.test("lophn-agent/roles/app-engineer#R4: 앱 목적과 SDK는 lophn의 기획에서 시작하고 기획이 없으면 지어내지 않는다", () => {
  const planned = interviewBasis({
    plan: { purpose: "사용량을 한눈에 본다", sdk: ["chart-sdk"] },
    humanWords: "사용량 앱이 필요해",
  });
  assertEquals(planned, {
    origin: "plan",
    purpose: "사용량을 한눈에 본다",
    sdk: ["chart-sdk"],
    needs_planning: false,
  });
  // 기획이 없으면 사람의 말은 있어도 목적과 SDK를 AE가 정하지 않고 기획을 먼저 요청한다.
  const human = interviewBasis({ plan: null, humanWords: "사용량 앱" });
  assertEquals(human, {
    origin: "human",
    purpose: null,
    sdk: [],
    needs_planning: true,
  });
  assertEquals(interviewBasis({ plan: null, humanWords: " " }).origin, "none");
});

Deno.test("lophn-agent/roles/app-engineer#R4: 앱 통합·공용 SDK는 lophn에, 용어 후보는 Context Engineer에 고정 근거와 함께 handoff한다", () => {
  assertEquals(decisionOwner("shared_sdk"), "lophn");
  assertEquals(decisionOwner("app_integration"), "lophn");
  assertEquals(decisionOwner("term_draft"), "context_engineer");
  assertEquals(decisionOwner("term_correspondence"), "context_engineer");
  assertEquals(decisionOwner("domain_model"), "app_engineer");
  const evidence = [{
    document: STORY,
    version: STORY_V1,
    section: null,
    question: null,
  }];
  for (
    const [topic, to] of [["shared_sdk", "lophn"], [
      "term_draft",
      "context_engineer",
    ]] as const
  ) {
    const routed = routeDecision({
      topic,
      what: "이 앱의 결정을 맡긴다",
      why: "앱 안 설계가 다룰 수 없다",
      evidence,
      expected: "결정과 근거",
    });
    assert(routed.ok, JSON.stringify(routed));
    assertEquals(routed.value.to_role, to);
    // 방향은 lophn-agent/handoff의 허용 방향이고 모양은 계약을 통과한다.
    assertEquals(handoffAllowed("app_engineer", routed.value.to_role), true);
    assert(handoffContentSchema.safeParse(routed.value.content).success);
    for (const reference of routed.value.references) {
      assert(handoffReferenceSchema.safeParse(reference).success);
    }
    assertEquals(routed.value.references.length, 1);
  }
});

Deno.test("lophn-agent/roles/app-engineer#R4: 고정 근거가 없거나 AE가 맡은 결정은 handoff하지 않는다", () => {
  const input = {
    what: "넘긴다",
    why: "이유",
    evidence: [],
    expected: "결과",
  };
  const noEvidence = routeDecision({ topic: "shared_sdk", ...input });
  assert(!noEvidence.ok);
  assertEquals(noEvidence.error.code, "invalid_input");
  const own = routeDecision({
    topic: "domain_model",
    ...input,
    evidence: [{
      document: STORY,
      version: STORY_V1,
      section: null,
      question: null,
    }],
  });
  assert(!own.ok);
  assertEquals(own.error.code, "invalid_input");
});

// --- R7: 인터뷰 질문 한도 ---------------------------------------------------------

function option(key: string, evidence = true) {
  return {
    key,
    label: `선택 ${key}`,
    description: `${key}로 정하면 이렇게 동작한다`,
    evidence: evidence
      ? [{ document: STORY, version: STORY_V1, section: null }]
      : [],
    adoption: null,
    action: null,
  };
}

function question(over: Partial<ChoiceQuestion> = {}): ChoiceQuestion {
  return {
    prompt: "빈 목록일 때 무엇을 보일까요?",
    options: [option("a"), option("b", false)],
    recommendation: { option_key: "a", explanation: "스토리가 그렇게 말한다" },
    ...over,
  };
}

Deno.test("lophn-agent/roles/app-engineer#R7: 충분히 답한 결정은 다시 묻지 않고 열세 번째 결정 질문 대신 남은 결정을 정리한다", () => {
  const open = Array.from({ length: 15 }, (_, index) => `topic-${index}`);
  assertEquals(INTERVIEW_QUESTION_MAX, 12);
  // 이미 답한 결정은 건너뛴다.
  assertEquals(
    nextInterviewStep({ asked: 2, open, answered: ["topic-0", "topic-1"] }),
    { kind: "ask", topic: "topic-2" },
  );
  // 열두 번째까지는 묻는다.
  assertEquals(nextInterviewStep({ asked: 11, open, answered: [] }), {
    kind: "ask",
    topic: "topic-0",
  });
  // 열세 번째 자리에는 질문 대신 남은 결정이 정리된다.
  const summary = nextInterviewStep({
    asked: 12,
    open,
    answered: ["topic-0"],
  });
  assertEquals(summary.kind, "summarize");
  assert(summary.kind === "summarize");
  assertEquals(summary.remaining.length, 14);
  assert(!summary.remaining.includes("topic-0"));
  // 남은 결정이 없으면 끝이다.
  assertEquals(nextInterviewStep({ asked: 3, open, answered: open }), {
    kind: "done",
  });
});

Deno.test("lophn-agent/roles/app-engineer#R7: 선택형 질문은 설명 있는 선택지 2~3개와 근거 있는 추천 하나로 좁힌다", () => {
  assertEquals(checkChoiceQuestion(question()), { ok: true, problems: [] });
  const three = question({
    options: [option("a"), option("b", false), option("c", false)],
  });
  assert(checkChoiceQuestion(three).ok);
  for (const draft of three.options) {
    assert(questionOptionSchema.safeParse(draft).success, draft.key);
  }
  // 선택지가 하나이거나 넷이면 좁히지 못한 질문이다.
  assertEquals(
    checkChoiceQuestion(question({ options: [option("a")] })).problems,
    ["option count outside 2..3"],
  );
  assert(
    checkChoiceQuestion(
      question({
        options: [option("a"), option("b"), option("c"), option("d")],
      }),
    ).problems.includes("option count outside 2..3"),
  );
  // 추천은 있어야 하고 제시한 선택지의 하나이며 근거가 있어야 한다.
  assertEquals(
    checkChoiceQuestion(question({ recommendation: null })).problems,
    ["recommendation missing"],
  );
  assertEquals(
    checkChoiceQuestion(
      question({ recommendation: { option_key: "z", explanation: "이유" } }),
    ).problems,
    ["recommendation names no offered option"],
  );
  assertEquals(
    checkChoiceQuestion(
      question({ recommendation: { option_key: "b", explanation: "이유" } }),
    ).problems,
    ["recommendation has no evidence"],
  );
  // 설명 없는 선택지는 설명을 요구한다.
  const bare = { ...option("a"), description: " " };
  assertEquals(
    checkChoiceQuestion(question({ options: [bare, option("b", false)] }))
      .problems,
    ["option without description: a"],
  );
});

// --- R8: 되읽기·가정·보류 ---------------------------------------------------------

Deno.test("lophn-agent/roles/app-engineer#R8: 답의 설계상 해석은 사람의 말로 되읽고 내부 이름을 싣지 않는다", () => {
  assert(checkReadBack("빈 목록이면 안내 문장을 보여 준다고 이해했습니다").ok);
  assertEquals(checkReadBack("  ").problems, ["read back is empty"]);
  assertEquals(
    checkReadBack(`${STORY}의 R10에 따라 처리`).problems,
    ["read back uses internal names"],
  );
});

Deno.test("lophn-agent/roles/app-engineer#R8: 범위·사용 동작·acceptance check의 답이 없으면 ticket을 보류하고 필요한 답을 설명한다", () => {
  assertEquals(
    ticketDecision({
      answered: ["scope", "behavior", "acceptance"],
      assumptions: ["a", "b", "c"],
    }),
    { status: "ready" },
  );
  for (
    const [answered, missing, word] of [
      [["behavior", "acceptance"], ["scope"], "범위"],
      [["scope", "acceptance"], ["behavior"], "사용 동작"],
      [["scope", "behavior"], ["acceptance"], "acceptance check"],
    ] as const
  ) {
    const decision = ticketDecision({ answered, assumptions: [] });
    assert(decision.status === "held");
    assertEquals(decision.missing, [...missing]);
    assertEquals(decision.over_assumed, false);
    assert(decision.explanation[0]!.includes(word));
  }
  const none = ticketDecision({ answered: [], assumptions: [] });
  assert(none.status === "held");
  assertEquals(none.missing, ["scope", "behavior", "acceptance"]);
});

Deno.test("lophn-agent/roles/app-engineer#R8: 가정이 3개를 넘으면 숨겨 넣지 않고 보류하며 이유를 설명한다", () => {
  assertEquals(ASSUMPTION_MAX, 3);
  const four = ticketDecision({
    answered: ["scope", "behavior", "acceptance"],
    assumptions: ["가정1", "가정2", "가정3", "가정4"],
  });
  assert(four.status === "held");
  assertEquals(four.over_assumed, true);
  assertEquals(four.missing, []);
  assertEquals(four.explanation.length, 1);
  assert(four.explanation[0]!.includes("4개"));
});

// --- R9: 설계 문서 종류와 저장 --------------------------------------------------

Deno.test("lophn-agent/roles/app-engineer#R9: 설계·해석 결과는 8종 Markdown 문서 종류이고 필요한 종류만 저장한다", () => {
  assertEquals([...DESIGN_DOCUMENT_KINDS], [
    "domain_story",
    "glossary_draft",
    "domain_model",
    "requirements",
    "usage_flow",
    "spec",
    "observation",
    "interpretation",
  ]);
  assertEquals(DESIGN_MEDIA_TYPE, "text/markdown");
  for (const kind of DESIGN_DOCUMENT_KINDS) {
    assert(DESIGN_DOCUMENT_TITLES[kind] !== "", kind);
  }
  // 요청이 필요로 하는 종류만 저장 대상이다(중복은 하나로, 정해진 순서로).
  assertEquals(
    planDesignSaves(["usage_flow", "domain_story", "usage_flow"]),
    { save: ["domain_story", "usage_flow"], unknown: [] },
  );
  assertEquals(planDesignSaves([]), { save: [], unknown: [] });
});

function documentWorld() {
  const calls: { contract: string; input: Record<string, unknown> }[] = [];
  const texts = new Map<string, string>([
    [`${STORY}@${STORY_V1}`, "# 도메인 스토리\n사용량을 본다."],
    [`${STORY}@${STORY_V2}`, "# 도메인 스토리\n사용량과 비용을 본다."],
    [`${MODEL}@${MODEL_V1}`, "# 도메인 모델\n사용량 항목."],
  ]);
  return {
    calls,
    call(
      contract: string,
      input: unknown,
    ): Promise<Result<unknown>> {
      const body = (input ?? {}) as Record<string, unknown>;
      calls.push({ contract, input: body });
      if (contract === "document.read") {
        const reference = body["reference"] as {
          document: string;
          version: string;
        };
        const text = texts.get(`${reference.document}@${reference.version}`);
        if (text === undefined) {
          return Promise.resolve(
            err({ code: "not_found", message: "no such version" }),
          );
        }
        return Promise.resolve(ok({
          as_of_seq: "1",
          document: reference.document,
          version: reference.version,
          latest_version: STORY_V2,
          format: { name: "document", module_hash: HASH, explicit: false },
          module_hash: HASH,
          section: null,
          section_status: "whole",
          include_children: false,
          ranges: [{ start_line: 1, end_line: 2 }],
          text,
          redacted: false,
          failure_reason: null,
          omission_reason: null,
          file: null,
          complete: true,
          next_cursor: null,
        }));
      }
      if (contract === "SaveToolDocument") {
        return Promise.resolve(ok({
          status: "saved",
          document: String(body["document"]),
          version: MODEL_V1,
          reference: String(body["document"]),
          event_seq: "2",
          warnings: [],
        }));
      }
      return Promise.resolve(
        err({ code: "invalid_input", message: contract }),
      );
    },
  };
}

function documentRig(world: ReturnType<typeof documentWorld>) {
  const cap = ROLE_CAPS.get("app_engineer")!;
  const listed = listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    { presetTools: cap.tools, roleTools: cap.tools },
  );
  const handlers = createBuiltinToolHandlers({
    call: world.call,
    newId: () => id("qst", 9),
    runFacts: () =>
      Promise.resolve(ok({
        session: null,
        role: "app_engineer" as const,
        original_message: id("msg", 1),
        assignment: id("asg", 1),
      })),
  });
  const operations = new Set(runOperations(listed));
  return (tool: string, input: unknown) =>
    executeTool(
      {
        listed,
        handlers,
        credential: {
          run: RUN,
          targets: new Set(),
          operations,
          call: CALL,
        } satisfies RunCredential,
      },
      tool,
      input,
    );
}

Deno.test("lophn-agent/roles/app-engineer#R9: 필요한 종류의 설계 문서는 담당 앱 자리에 Markdown으로 저장되고 형식 저장 검사는 documents가 한다", async () => {
  const world = documentWorld();
  const run = documentRig(world);
  const { save } = planDesignSaves(["domain_story", "requirements"]);
  for (const kind of save) {
    const saved = await run("document.create", {
      title: DESIGN_DOCUMENT_TITLES[kind],
      place: { kind: "app", id: APP },
      name: kind.replaceAll("_", "-"),
      text: `# ${DESIGN_DOCUMENT_TITLES[kind]}\n본문`,
      media_type: DESIGN_MEDIA_TYPE,
    });
    assertEquals(saved.outcome.kind, "success", kind);
  }
  const sent = world.calls.filter((call) =>
    call.contract === "SaveToolDocument"
  );
  // 저장한 문서는 요청한 두 종류뿐이다.
  assertEquals(sent.length, 2);
  for (const call of sent) {
    assertEquals(call.input["media_type"], "text/markdown");
    // 명시 format 없이 넘기고 형식 저장 검사는 소유 contract의 몫이다.
    assertEquals(call.input["format"], null);
    assertEquals(
      (call.input["metadata"] as { place: unknown }).place,
      { kind: "app", id: APP },
    );
    assert(saveToolDocumentInputSchema.safeParse(call.input).success);
  }
});

// --- R10: 설계 순서와 읽은 고정 version 근거 --------------------------------------

Deno.test("lophn-agent/roles/app-engineer#R10: 새 앱 설계는 정해진 순서로 진행하고 앞 단계가 끝나야 뒤 단계를 시작한다", () => {
  assertEquals(DESIGN_STEPS.map((step) => step.key), [
    "story_terms",
    "model_operations",
    "requirements",
    "usage_flow",
    "spec",
    "observation",
    "contract_request",
  ]);
  assertEquals(DESIGN_STEPS[0]!.kinds, ["domain_story", "glossary_draft"]);
  // 앱 계약의 요구는 마지막 단계다.
  assertEquals(DESIGN_STEPS.at(-1)!.key, "contract_request");
  assertEquals(nextDesignStep([]), "story_terms");
  assertEquals(
    nextDesignStep(["story_terms", "model_operations"]),
    "requirements",
  );
  assertEquals(nextDesignStep(DESIGN_STEPS.map((step) => step.key)), undefined);
  assertEquals(canStartStep("story_terms", []), true);
  assertEquals(canStartStep("spec", ["story_terms"]), false);
  assertEquals(canStartStep("contract_request", []), false);
  // 이번 요청에 필요 없어 건너뛴 단계는 끝난 것으로 센다.
  assertEquals(
    canStartStep("spec", [
      "story_terms",
      "model_operations",
      "requirements",
      "usage_flow",
    ]),
    true,
  );
});

Deno.test("lophn-agent/roles/app-engineer#R10: 뒤 단계 근거는 앞 단계 결과를 실제 읽은 고정 version으로 든다", () => {
  const results: StepResult[] = [
    { step: "story_terms", document: STORY, version: STORY_V1 },
    { step: "model_operations", document: MODEL, version: MODEL_V1 },
  ];
  const read = new Set([`${MODEL}@${MODEL_V1}`, `${STORY}@${STORY_V1}`]);
  // 직전 단계 결과를 근거로 든 요구사항 단계다.
  assertEquals(
    checkStepBasis(
      "requirements",
      [{ document: MODEL, version: MODEL_V1 }],
      results,
      read,
    ),
    { ok: true, problems: [] },
  );
  // 근거를 빼면 앞 결과를 근거로 삼지 않은 판단이다.
  assertEquals(
    checkStepBasis(
      "requirements",
      [{ document: STORY, version: STORY_V1 }],
      results,
      read,
    )
      .problems,
    ["basis misses the model_operations result"],
  );
  // 읽지 않은 version은 근거가 아니다.
  assertEquals(
    checkStepBasis(
      "requirements",
      [{ document: MODEL, version: MODEL_V1 }],
      results,
      new Set(),
    )
      .problems,
    [`basis version not read: ${MODEL}@${MODEL_V1}`],
  );
  // 첫 단계는 앞 결과가 없다.
  assertEquals(checkStepBasis("story_terms", [], [], new Set()).ok, true);
});

Deno.test("lophn-agent/roles/app-engineer#R10: 후속 version이 생겨도 근거로 읽은 고정 판으로 돌아갈 수 있고 기존 판단 근거는 바뀌지 않는다", async () => {
  const world = documentWorld();
  const run = documentRig(world);
  // 앞 결과의 v1을 읽는다. 그 사이 최신 판은 v2가 되었다.
  const read = await run("document.read_version", {
    reference: { document: STORY, version: STORY_V1, section: null },
  });
  assertEquals(read.outcome.kind, "success");
  assertEquals(
    (read.result.content as { text: string; latest_version: string }).text,
    "# 도메인 스토리\n사용량을 본다.",
  );
  assertEquals(
    (read.result.content as { latest_version: string }).latest_version,
    STORY_V2,
  );
  // v1을 근거로 쓴 다음 단계 문서는 그 고정 version이 읽은 근거로 남는다.
  const next = await run("document.create", {
    title: "도메인 모델",
    place: { kind: "app", id: APP },
    name: "domain-model",
    text: "# 도메인 모델\n사용량 항목.",
    media_type: DESIGN_MEDIA_TYPE,
    evidence: {
      relied_on: [{ document: STORY, version: STORY_V1 }],
      missing: [],
    },
  });
  assertEquals(next.outcome.kind, "success");
  const evidence = (next.result.content as {
    evidence: { read: unknown[]; not_read: unknown[]; all_read: boolean };
  }).evidence;
  assertEquals(evidence.read, [{ document: STORY, version: STORY_V1 }]);
  assertEquals(evidence.all_read, true);
  // 읽지 않은 후속 version을 근거로 든 문서는 읽은 근거가 아니다.
  const unread = await run("document.create", {
    title: "요구사항",
    place: { kind: "app", id: APP },
    name: "requirements",
    text: "# 요구사항\n사용량과 비용.",
    media_type: DESIGN_MEDIA_TYPE,
    evidence: {
      relied_on: [{ document: STORY, version: STORY_V2 }],
      missing: [],
    },
  });
  const later = (unread.result.content as {
    evidence: { not_read: unknown[]; all_read: boolean };
  }).evidence;
  assertEquals(later.not_read, [{ document: STORY, version: STORY_V2 }]);
  assertEquals(later.all_read, false);
});

// --- R11: 전체 명세 ---------------------------------------------------------------

function spec(over: Partial<SpecDraft> = {}): SpecDraft {
  return {
    purpose: "사용량을 한눈에 본다",
    out_of_scope: ["다른 사람의 사용량 비교"],
    flows: [
      {
        name: "사용량 보기",
        kind: "main",
        of: null,
        steps: ["앱을 연다", "기간을 고른다", "사용량 목록을 본다"],
        may_be_empty: true,
        may_fail: true,
      },
      {
        name: "사용량 없음",
        kind: "empty",
        of: "사용량 보기",
        steps: ["기간에 사용량이 없다는 안내를 본다"],
      },
      {
        name: "읽기 실패",
        kind: "failure",
        of: "사용량 보기",
        steps: ["읽지 못했다는 안내와 다시 시도 동작을 본다"],
      },
    ],
    invariants: ["합계는 목록의 합과 같다"],
    acceptance: ["사용량이 없으면 안내를 본다"],
    assumptions: ["기간 기본값은 최근 7일이다"],
    text: "# 전체 명세\n현재 동작을 설명한다.",
    ...over,
  };
}

Deno.test("lophn-agent/roles/app-engineer#R11: 전체 명세는 목적·범위 밖·동작·불변식·acceptance check을 담는다", () => {
  assertEquals(checkSpec(spec()), { ok: true, problems: [] });
  assertEquals(checkSpec(spec({ purpose: " " })).problems, ["purpose missing"]);
  assertEquals(checkSpec(spec({ out_of_scope: [] })).problems, [
    "out of scope missing",
  ]);
  assertEquals(checkSpec(spec({ invariants: [] })).problems, [
    "invariant missing",
  ]);
  assertEquals(checkSpec(spec({ acceptance: [] })).problems, [
    "acceptance check missing",
  ]);
  assert(checkSpec(spec({ flows: [] })).problems.includes("main flow missing"));
});

Deno.test("lophn-agent/roles/app-engineer#R11: 흐름 하나는 최대 8단계이고 9단계 흐름은 나뉜다", () => {
  assertEquals(SPEC_FLOW_STEP_MAX, 8);
  const steps = Array.from({ length: 9 }, (_, index) => `단계 ${index + 1}`);
  const long = spec().flows[0]!;
  const nine = { ...long, steps, may_be_empty: false, may_fail: false };
  assertEquals(
    checkSpec(spec({ flows: [nine] })).problems,
    ["flow too long: 사용량 보기"],
  );
  const parts = splitFlow(nine);
  assertEquals(parts.map((part) => part.steps.length), [8, 1]);
  assertEquals(parts.map((part) => part.name), [
    "사용량 보기 (1/2)",
    "사용량 보기 (2/2)",
  ]);
  assertEquals(checkSpec(spec({ flows: parts })).ok, true);
  // 8단계는 그대로 둔다.
  assertEquals(splitFlow({ ...nine, steps: steps.slice(0, 8) }).length, 1);
});

Deno.test("lophn-agent/roles/app-engineer#R11: 빈 결과와 실패는 별도 흐름이어야 한다", () => {
  const [main, empty, failure] = spec().flows;
  assertEquals(
    checkSpec(spec({ flows: [main!, failure!] })).problems,
    ["empty flow missing: 사용량 보기"],
  );
  assertEquals(
    checkSpec(spec({ flows: [main!, empty!] })).problems,
    ["failure flow missing: 사용량 보기"],
  );
  // 빈 결과·실패 흐름이 어느 main 흐름의 것인지 가리켜야 한다.
  assertEquals(
    checkSpec(
      spec({ flows: [main!, empty!, { ...failure!, of: "없는 흐름" }] }),
    )
      .problems.includes("failure flow has no main flow: 읽기 실패"),
    true,
  );
});

Deno.test("lophn-agent/roles/app-engineer#R11: 시각 배치·색·컴포넌트·라이브러리·저장 구현은 정하지 않는다", () => {
  assertEquals(implementationChoices("사용량 목록을 본다"), []);
  assertEquals(implementationChoices("왼쪽 사이드바 레이아웃에 둔다"), [
    "layout",
  ]);
  assertEquals(implementationChoices("버튼 색상은 #ff0000이다"), ["color"]);
  assertEquals(implementationChoices("React 컴포넌트로 만든다").sort(), [
    "component",
    "library",
  ]);
  assertEquals(implementationChoices("SQLite에 저장한다"), ["storage"]);
  const chosen = spec({
    invariants: [
      "합계는 목록의 합과 같다",
      "Redux 라이브러리로 상태를 관리한다",
    ],
  });
  assertEquals(checkSpec(chosen).problems, ["implementation choice: library"]);
});

Deno.test("lophn-agent/roles/app-engineer#R11: 명세는 최신 판 하나로 현재 동작을 알 수 있어야 하고 가정은 3개까지다", () => {
  assertEquals(
    checkSpec(spec({ text: "# 전체 명세\n이전 판과 같다." })).problems,
    ["refers to another version"],
  );
  assertEquals(
    checkSpec(spec({ assumptions: ["가", "나", "다"] })).ok,
    true,
  );
  assertEquals(
    checkSpec(spec({ assumptions: ["가", "나", "다", "라"] })).problems,
    ["too many assumptions"],
  );
});

// --- R12: 앱 계약의 요구 ----------------------------------------------------------

function request(over: Partial<ContractRequest> = {}): ContractRequest {
  return {
    operations: [{
      operation: "사용량 기록",
      commands: [
        { key: "read_usage", effect: "read" },
        { key: "add_usage", effect: "write" },
      ],
      automation: "매일 밤 합계를 갱신한다",
    }],
    permissions: [
      { command: "read_usage", reason: "목록을 보이려면 읽어야 한다" },
    ],
    text: "도메인 조작 '사용량 기록'은 read_usage와 add_usage로 이룬다.",
    ...over,
  };
}

Deno.test("lophn-agent/roles/app-engineer#R12: 앱 계약의 요구는 도메인 조작·명령·automation·필요 권한을 잇고 요구에 없는 권한을 더하지 않는다", () => {
  assertEquals(checkContractRequest(request()), { ok: true, problems: [] });
  assertEquals(
    checkContractRequest(request({ operations: [], permissions: [] }))
      .problems,
    ["operation missing"],
  );
  assertEquals(
    checkContractRequest(
      request({
        operations: [{ operation: "삭제", commands: [], automation: null }],
        permissions: [],
      }),
    ).problems,
    ["operation has no command: 삭제"],
  );
  // 요구한 명령에서 나오지 않은 권한이나 이유 없는 권한은 거절한다.
  assertEquals(
    checkContractRequest(
      request({ permissions: [{ command: "purge", reason: "정리" }] }),
    ).problems,
    ["permission outside the request: purge"],
  );
  assertEquals(
    checkContractRequest(
      request({ permissions: [{ command: "add_usage", reason: " " }] }),
    ).problems,
    ["permission without reason: add_usage"],
  );
});

Deno.test("lophn-agent/roles/app-engineer#R12: blueprint 원본 수정과 같은 계약의 문서 사본은 만들지 않는다", () => {
  const copied = JSON.stringify({
    commands: [{ key: "read_usage", effect: "read" }],
  });
  assertEquals(
    checkContractRequest(request({ text: `계약 전문:\n${copied}` })).problems,
    ["blueprint copy in the request"],
  );
  // 문서 종류에 blueprint 사본은 없다.
  const plan = planDesignSaves(["blueprint", "contract_copy"]);
  assertEquals(plan.save, []);
  assertEquals(plan.unknown, ["blueprint", "contract_copy"]);
  // AE의 app.* tool은 읽기뿐이고 blueprint 쓰기 tool은 정의조차 없다.
  const cap = ROLE_CAPS.get("app_engineer")!;
  const listed = listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    { presetTools: cap.tools, roleTools: cap.tools },
  );
  const appTools = listed.filter((tool) => tool.name.startsWith("app."));
  assert(appTools.length > 0);
  for (const tool of appTools) assertEquals(tool.effect, "read", tool.name);
  assertEquals(
    BUILTIN_TOOLS.filter((tool) => /blueprint/.test(tool.name)).map((tool) =>
      tool.name
    ),
    ["app.blueprint"],
  );
});

// --- R20: judgment·organizing 용도 ------------------------------------------------

function catalogEntry(): CatalogEntry {
  return {
    provider_definition: "anthropic",
    model_name: "claude-haiku-4-5",
    context_limit: 200_000,
    input_limit: 190_000,
    output_limit: 8_000,
    supports_tools: true,
    input_media: ["text"],
    output_media: ["text"],
    reasoning: {
      mode: "named",
      levels: ["low", "medium", "high"],
      minimum_budget: null,
      maximum_budget: null,
      default_level: "medium",
    },
    preview: false,
    deprecated: false,
    source: "release_snapshot",
    source_revision: "2026-10",
    checked_at: "2026-10-07T00:00:00.000Z",
    received_at: "2026-10-07T00:00:00.000Z",
    price_basis: null,
  };
}

Deno.test("lophn-agent/roles/app-engineer#R20: 인터뷰 해석·설계·가설·ticket 범위·release 의미·handoff 판단은 judgment이고 제목·요약은 organizing이다", () => {
  for (
    const call of [
      "interview_reading",
      "design_body",
      "cause_hypothesis",
      "ticket_scope",
      "release_meaning",
      "handoff_decision",
    ] as const
  ) {
    assertEquals(purposeOf(call), "judgment", call);
  }
  for (
    const call of ["ticket_title", "document_title", "summary"] as const
  ) {
    assertEquals(purposeOf(call), "organizing", call);
  }
  // ticket 범위 선택은 본문 판단이라 제목 정리와 구별된다.
  assert(purposeOf("ticket_scope") !== purposeOf("ticket_title"));
});

Deno.test("lophn-agent/roles/app-engineer#R20: 실제 provider·model·계정은 preset 선택의 두 용도로 정해지고 역할 상한은 model 이름을 고정하지 않는다", () => {
  const deps: ValidateDeps = {
    bundles: TOOL_BUNDLES,
    mcpServers: new Map(),
    roleCaps: ROLE_CAPS,
    definitionKey: (provider) =>
      provider === id("pvd", 1) ? "anthropic" : undefined,
    modelListed: (_definition, name) => name === "claude-haiku-4-5",
    credentialKeys: (provider) => provider === id("pvd", 1) ? ["key-main"] : [],
    catalogEntry: (_definition, name) =>
      name === "claude-haiku-4-5" ? catalogEntry() : undefined,
  };
  const selection = {
    provider: id("pvd", 1),
    credentials: ["key-main"],
    model_name: "claude-haiku-4-5",
    reasoning_level: "medium" as const,
    options: {},
  };
  const both = validateDefinition({
    ...productPresetDefinition("app_engineer", HASH),
    model: selection,
    organizing_model: { ...selection, reasoning_level: "low" as const },
  }, deps);
  assert(both.ok, JSON.stringify(both));
  assertEquals(both.value.model!.purpose, "judgment");
  assertEquals(both.value.organizing_model!.purpose, "organizing");
  // 확인되지 않은 model은 저장을 거절한다.
  const unverified = validateDefinition({
    ...productPresetDefinition("app_engineer", HASH),
    model: selection,
    organizing_model: null,
  }, { ...deps, catalogEntry: () => undefined });
  assert(!unverified.ok);
  const cap = ROLE_CAPS.get("app_engineer")!;
  assertEquals(
    cap.tools.some((tool) =>
      tool.startsWith("model.") || tool.startsWith("provider.") ||
      tool.includes("claude") || tool.includes("gpt")
    ),
    false,
  );
});
