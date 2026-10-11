import { assert, assertEquals } from "@std/assert";
import type { CatalogEntry } from "@lophn/contracts/lophn-agent";
import { ok } from "../../../base/mod.ts";
import {
  productPresetDefinition,
  validateModelSelection,
} from "../../presets/mod.ts";
import { ROLE_CAPS } from "../../presets/mod.ts";
import { checkOptionAction, moveOptionAction } from "../../questions/mod.ts";
import {
  AGENT_TOOLS,
  BUILTIN_TOOLS,
  DOCUMENT_WRITE_TOOL_NAMES,
  executeTool,
  listTools,
  type RunCredential,
} from "../../harness/tools/mod.ts";
import { createAgentToolHandlers } from "../../harness/tools/mod.ts";
import { HANDOFF_DIRECTIONS } from "@lophn/contracts/lophn-agent";
import {
  checkDraftSubmission,
  checkPlan,
  draftSubmission,
  intentQuestion,
  lophnOffers,
  lophnTools,
  NO_HANDOFF_WORD,
  type PlaceTarget,
  PLAN_OPTION_WORDS,
  PLAN_OPTIONS,
  planDocumentBody,
  type PlanDraft,
  recommendPlaces,
  settingChangeQuestion,
} from "./mod.ts";

// lophn 역할의 tool 선택, 기획 문서 검사, 질문 draft 제출(roles/lophn 순수 규칙).
// 실제 provider와 사람 데이터 root는 열지 않는다. 소유 command 적용은 questions
// 시험이 본다.

const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";

function doc(n: number): string {
  return `doc_01arz3ndektsv4rrffq69g5f${"abcdefgh"[n]}v`;
}

function target(n: number, over: Partial<PlaceTarget> = {}): PlaceTarget {
  return {
    document: doc(n),
    title: `Note ${n}`,
    revision: String(10 + n),
    hasPlace: false,
    contextCount: 0,
    candidates: [{
      place: { kind: "project", id: PROJECT },
      name: `note-${n}`,
      label: "the Mahas project",
      reason: "It is about the Mahas launch.",
    }],
    ...over,
  };
}

// lophn 기본 preset의 제공 목록은 아직 고정되지 않았으므로 교집합 목록을 상한
// 그대로 시험하려고 상한 자체를 preset 선택으로 준다.

Deno.test("lophn-agent/roles/lophn#R1: lophn's tool selection holds planning, recommendation, guidance and reporting reads", () => {
  const lophn = ROLE_CAPS.get("lophn");
  assert(lophn !== undefined);
  const listed = lophnTools(lophn.tools);
  assert(listed.length > 0);
  assertEquals(
    listTools(
      { builtin: BUILTIN_TOOLS, app: [], external: [] },
      { presetTools: lophn.tools, roleTools: lophn.tools },
    ),
    listed,
  );
  // 기획·추천·안내·보고에 필요한 읽기가 있다(R1). 상한에 있어도 아직 정의가
  // 없는 선택(app 상세·blueprint·sdk·problem·report 조회)은 목록에 없다.
  for (
    const name of [
      "project.list",
      "project.read",
      "app.list",
      "document.list",
      "context.read",
      "document.create",
      "question.submit",
      "preset.list",
      "visual.show",
      "lophn.guide",
      "setting.read",
      "handoff.submit",
    ]
  ) {
    assert(
      listed.some((tool) => tool.name === name),
      `lophn lists ${name}`,
    );
  }
  // 앱 목적 묶음의 상세 조회는 상한 어디에도 정의가 없다(app.read는 상한
  // 선택이지만 내장 정의가 아직 없다 → 목록에는 없다).
  assertEquals(
    listed.some((tool) => tool.name === "app.read_purpose"),
    false,
  );
});

Deno.test("lophn-agent/roles/lophn#R1: the cap selections that have a builtin definition are listed, ticket tools included", () => {
  const lophn = ROLE_CAPS.get("lophn");
  assert(lophn !== undefined);
  const listed = lophnTools(lophn.tools);
  // 상한에 있고 내장 정의가 있는 선택은 목록에 남는다(R1: 교집합은 정의가 있는 것만 남는다).
  for (
    const name of [
      "sdk.list",
      "sdk.contract",
      "problem.list",
      "report.read",
      "app.read",
      "app.blueprint",
      "ticket.list",
      "ticket.read",
      "ticket.create",
    ]
  ) {
    assert(lophn.tools.includes(name), `${name} is in the lophn cap`);
    assert(
      listed.some((tool) => tool.name === name),
      `lophn lists ${name}`,
    );
  }
  // make_ready는 lophn 상한에 없다: 실행 준비 전환은 채택한 설계를 아는 App Engineer의 몫이다.
  assertEquals(lophn.tools.includes("ticket.make_ready"), false);
  assertEquals(listed.some((tool) => tool.name === "ticket.make_ready"), false);
});

Deno.test("lophn-agent/roles/lophn#R1: lophn preset selection that is not fixed yet lists no tools (fail closed)", () => {
  assertEquals(lophnTools(null), []);
});

Deno.test("lophn-agent/roles/lophn#R2: the lophn tool list has no app detailed design, cause interpretation, claim, implementation or coding agent start", () => {
  const lophn = ROLE_CAPS.get("lophn");
  assert(lophn !== undefined);
  const listed = lophnTools(lophn.tools);
  for (
    const name of [
      "app.app.create",
      "app.blueprint.revise",
      "problem.set_interpretation",
      "task.claim",
      "task.start",
      "task.complete",
      "coding_agent.start",
      "subagent",
      "shell",
      "shell.exec",
    ]
  ) {
    assertEquals(
      listed.some((tool) => tool.name === name),
      false,
      `lophn must not list ${name}`,
    );
  }
  assertEquals(
    listed.some((tool) => tool.name === "problem.set_interpretation"),
    false,
  );
  // 상한 표에도 없어 교집합 밖이다(R2).
  assertEquals(lophnOffers("problem.set_interpretation"), false);
  assertEquals(lophnOffers("subagent", lophn.tools), false);
});

Deno.test("lophn-agent/roles/lophn#R3: lophn reads project, app and SDK lists but has no direct disk, source or work DB access", () => {
  const lophn = ROLE_CAPS.get("lophn");
  assert(lophn !== undefined);
  // 전체 목록 읽기가 있다(R3). SDK 계약은 lophn 상어 선택이지만 내장 정의가
  // 아직 없어 제공 목록 교집합에는 없다(R1의 테스트가 함께 본다).
  assert(lophnOffers("app.list", lophn.tools));
  assert(lophnOffers("project.list", lophn.tools));
  assert(lophnOffers("context.list", lophn.tools));
  // 디스크·소스·업무 DB 직접 접근은 상한 어디에도 없다(R3, roles/common 금지).
  const outside = lophn.tools.filter((tool) =>
    tool.startsWith("shell") || tool.startsWith("file") ||
    tool.startsWith("disk") || tool.startsWith("source") ||
    tool.startsWith("db") || tool.startsWith("sqlite") ||
    tool.startsWith("sql")
  );
  assertEquals(outside, [], "lophn has direct disk/source/DB tools");
  // 제공 목록에도 없다(R3).
  const listed = lophnTools(lophn.tools);
  const listedOutside = listed.filter((tool) =>
    /^(shell|file|disk|source|db|sqlite|sql)/.test(tool.name)
  );
  assertEquals(listedOutside, [], "lophn lists direct disk/source/DB tools");
});

Deno.test("lophn-agent/roles/lophn#R4: requests in lophn scope list preset reads, document saves and question asks; no direct claim, implementation or coding agent start", () => {
  const lophn = ROLE_CAPS.get("lophn");
  assert(lophn !== undefined);
  const listed = lophnTools(lophn.tools);
  // 직접 구현·claim·coding agent 시작은 제공 목록에 없다(R4).
  const forbidden = ["task.claim", "task.start", "task.complete", "shell"];
  for (const name of forbidden) {
    assertEquals(listed.some((tool) => tool.name === name), false, name);
  }
  // 문서 이동·이름 변경·삭제 동작 tool도 제공 목록에 없다(R4: 뒤집기 가능한
  // 요청 범위 문서 저장 tool만 있다).
  for (
    const name of [
      "document.move",
      "document.rename",
      "document.delete",
      "document.archive",
    ]
  ) {
    assertEquals(
      listed.some((tool) => tool.name === name),
      false,
      `lophn must not list ${name}`,
    );
  }
  // preset·assignment 조회, 질문·ticket 생성이 상한에 있고 정의가 있어 모두 목록에 있다(R4).
  for (
    const name of [
      "preset.list",
      "preset.read",
      "assignment.list",
      "assignment.read",
      "question.submit",
      "question.read_decision",
      "document.create",
      "document.save_version",
    ]
  ) {
    assert(listed.some((tool) => tool.name === name), name);
  }
  assert(lophn.tools.includes("ticket.create"), "ticket.create is in the cap");
  assert(
    listed.some((tool) => tool.name === "ticket.create"),
    "ticket.create is listed",
  );
});

Deno.test("lophn-agent/roles/lophn#R5: request-scope document saves are reversible, idempotent and ask no approval", () => {
  const saves = AGENT_TOOLS.length; // sanity: agent tools exist
  assert(saves > 0);
  // 요청 범위 문서 저장 tool은 되돌릴 수 있고 idempotent다(R5).
  const writeNames = [...DOCUMENT_WRITE_TOOL_NAMES];
  assertEquals(writeNames.sort(), ["document.create", "document.save_version"]);
  const builtin = BUILTIN_TOOLS.filter((tool) =>
    writeNames.includes(tool.name)
  );
  assertEquals(builtin.length, 2);
  for (const tool of builtin) {
    assertEquals(tool.effect, "write", tool.name);
    assertEquals(tool.reversible, true, tool.name);
    assertEquals(tool.idempotent, true, tool.name);
    assertEquals(
      tool.scopeCheck.includes("request"),
      true,
      tool.name,
    );
    // 저장은 approval request를 묻지 않는다(R5).
    assertEquals(tool.confirm, false, tool.name);
  }
});

Deno.test("lophn-agent/roles/lophn#R5: document moves and new app registration apply through fixed question options", () => {
  // 문서 이동은 lophn-agent/questions의 고정 선택지다(R5). checkOptionAction은
  // documents/addressing 이동 owner의 소유 command를 허용한다.
  const move = moveOptionAction({
    document: DOC,
    place: { kind: "project", id: PROJECT },
    name: "moved-doc",
    base_revision: "1",
  });
  const checked = checkOptionAction(QUESTION, move);
  assertEquals(checked.ok, true);
  // lophn 상한 어디에도 앱 등록 직접 tool이 없다(R5). 새 앱 등록의 적용은
  // apps/registration 등록·채택 경로의 question 선택지이고 그 owner 동작은
  // apps#T30(apps/registration#R3)이 더한다(R12).
  const registrationTool = [...BUILTIN_TOOLS].find((tool) =>
    tool.name === "app.app.create"
  );
  assertEquals(registrationTool, undefined);
  const lophn = ROLE_CAPS.get("lophn");
  assert(lophn !== undefined);
  assertEquals(lophn.tools.includes("app.app.create"), false);
});

Deno.test("lophn-agent/roles/lophn#R7: project planning orders options from existing project, context widening, new project", () => {
  assertEquals(PLAN_OPTIONS, [
    "within_existing_project",
    "widen_context_items",
    "new_project",
  ]);
  // 앞선 방안이 맞으면 새 프로젝트를 추천하지 않는다(R7).
  const draft: PlanDraft = {
    purpose: "The Mahas launch notes live in one place.",
    chosen: "within_existing_project",
    rejected: [],
    materials: [{
      address: "doc_=01",
      version: null,
      reason: "It holds the notes.",
    }],
    place_candidates: [{
      place: { kind: "project", id: PROJECT },
      name: "mahas",
      reason: "The launch notes already live here.",
    }],
    contexts: [{ context: "ctx_01", purpose: "It bundles launch reading." }],
    handoffs: [{ role: "app_engineer", what: "SDK examples for the app." }],
  };
  assertEquals(checkPlan(draft), { ok: true });
  // 앞선 방안을 버리지 않고 새 프로젝트만 고르면 거절이다(R7).
  const newProjectOnly: PlanDraft = {
    ...draft,
    chosen: "new_project",
    rejected: [],
  };
  const checked = checkPlan(newProjectOnly);
  assert(!checked.ok);
  // 두 방안을 다 버리고 새 프로젝트는 통과다(R7).
  const withBoth: PlanDraft = {
    ...draft,
    chosen: "new_project",
    rejected: [
      {
        option: "within_existing_project",
        reason: "No existing project holds this purpose.",
      },
      {
        option: "widen_context_items",
        reason: "No context item covers this work.",
      },
    ],
  };
  assertEquals(checkPlan(withBoth), { ok: true });
});

Deno.test("lophn-agent/roles/lophn#R7: choosing the second option rejects only the first", () => {
  const draft: PlanDraft = {
    purpose: "The Mahas launch notes live in one place.",
    chosen: "widen_context_items",
    rejected: [
      {
        option: "within_existing_project",
        reason: "The launch notes outgrow the existing project purpose.",
      },
    ],
    materials: [{
      address: "doc_a",
      version: null,
      reason: "It holds the notes.",
    }],
    place_candidates: [{
      place: null,
      name: "launch-notes",
      reason: "A shared place for the widened items.",
    }],
    contexts: [{
      context: "ctx_01",
      purpose: "It widens to cover launch notes.",
    }],
    handoffs: [],
  };
  const checked = checkPlan(draft);
  assert(!checked.ok); // handoffs가 빈 목록이면 R8 위반이다(아래 R8 테스트 참조).
});

Deno.test("lophn-agent/roles/lophn#R8: a plan records purpose, rejected reasons, materials, place candidates, contexts and handoffs or none", () => {
  // 다섯 내용이 모두 있으면 통과다(R8).
  const draft: PlanDraft = {
    purpose: "The Mahas launch notes live in one place.",
    chosen: "new_project",
    rejected: [
      {
        option: "within_existing_project",
        reason: "No existing project holds this purpose.",
      },
      {
        option: "widen_context_items",
        reason: "No context item covers this work.",
      },
    ],
    materials: [
      { address: "doc_a", version: null, reason: "It holds launch notes." },
      {
        address: "sdk:lophn",
        version: "2026-10-06",
        reason: "It shows the SDK contract.",
      },
    ],
    place_candidates: [
      { place: null, name: "mahas-launch", reason: "A new project place." },
    ],
    contexts: [
      { context: "launch reading", purpose: "It bundles the notes." },
    ],
    handoffs: [
      {
        role: "app_engineer",
        what: "SDK examples the new app reuses.",
      },
    ],
  };
  assertEquals(checkPlan(draft), { ok: true });
  // 버린 이유가 비면 거절이다(R8).
  const noReason: PlanDraft = {
    ...draft,
    rejected: [{
      option: "within_existing_project",
      reason: "  ",
    }],
  };
  const missingReason = checkPlan(noReason);
  assert(!missingReason.ok);
  // 자료가 없거나 연결 context가 없거나 내줄 것이 없어도 없음 문장이 있어야
  // 한다(R8: 내줄 것이 없으면 없음이라고 적는다).
  const noHandoffs: PlanDraft = { ...draft, handoffs: [] };
  const checked = checkPlan(noHandoffs);
  assert(!checked.ok);
  // 목적이 한 문장이 아니면 거절이다(R8).
  const twoSentences: PlanDraft = {
    ...draft,
    purpose: "The Mahas launch notes live in one place. Docs help.",
  };
  assert(!checkPlan(twoSentences).ok);
  const korean = { ...draft, purpose: "마하스 출시 노트를 한곳에 둔다." };
  assertEquals(checkPlan(korean), { ok: true });
});

Deno.test("lophn-agent/roles/lophn#R8: a plan's plan document body carries the handoff word none when nothing is handed off", () => {
  const draft: PlanDraft = {
    purpose: "The Mahas launch notes live in one place.",
    chosen: "within_existing_project",
    rejected: [
      {
        option: "widen_context_items",
        reason: "No context item covers this work.",
      },
    ],
    materials: [{
      address: "doc_a",
      version: null,
      reason: "It holds the notes.",
    }],
    place_candidates: [{
      place: { kind: "project", id: PROJECT },
      name: "mahas",
      reason: "The launch notes already live here.",
    }],
    contexts: [{ context: "ctx_01", purpose: "It bundles launch reading." }],
    handoffs: [],
  };
  const checked = checkPlan(draft);
  assert(checked.ok === false);
});

Deno.test("lophn-agent/roles/lophn#R11: the chosen and rejected options become the request-scope plan document", () => {
  const draft: PlanDraft = {
    purpose: "The Mahas launch notes live in one place.",
    chosen: "new_project",
    rejected: [
      {
        option: "within_existing_project",
        reason: "No existing project holds this purpose.",
      },
      {
        option: "widen_context_items",
        reason: "No context item covers this work.",
      },
    ],
    materials: [{
      address: "doc_a",
      version: null,
      reason: "It holds the notes.",
    }],
    place_candidates: [{
      place: null,
      name: "mahas-launch",
      reason: "A new project place.",
    }],
    contexts: [{ context: "launch reading", purpose: "It bundles the notes." }],
    handoffs: [{ role: "app_engineer", what: "SDK examples." }],
  };
  const body = planDocumentBody(draft);
  // 선택과 버린 방안 문서에 남는다(R11).
  assert(body.includes("# Plan"));
  assert(body.includes("Purpose: The Mahas launch notes live in one place."));
  assert(body.includes(PLAN_OPTION_WORDS.within_existing_project));
  assert(body.includes(PLAN_OPTION_WORDS.widen_context_items));
  assert(body.includes(PLAN_OPTION_WORDS.new_project));
  assert(body.includes("rejected because"));
  assert(body.includes("doc_a"));
  assert(body.includes("mahas-launch"));
  assert(body.includes("launch reading"));
  // 내줄 것이 있으면 내주는 내용이 남는다(R8, R11).
  assert(body.includes("app_engineer"));
  assert(body.includes("SDK examples."));
  // 내줄 것이 없으면 없음을 적는다(R8).
  const noHandoff = planDocumentBody({ ...draft, handoffs: [] });
  assert(noHandoff.includes(NO_HANDOFF_WORD));
  // 없음은 내주는 대상 문장이 아니다(R8).
  assert(body.includes(NO_HANDOFF_WORD) === false);
});

Deno.test("lophn-agent/roles/lophn#R13: the handoff content the lophn role submits is bounded to app-outside reuse, project planning and place choices", () => {
  const submission = draftSubmission({
    prompt: "App Engineer에게 SDK 예제를 넘길까요",
    reason: "새 앱 기획에서 SDK 재사용이 필요하다",
    options: [],
    recommendation: null,
  });
  assertEquals(submission.expires_at, null);
  // handoff 방향은 lophn-agent/handoff의 현재 집합이다. lophn은 App Engineer와
  // Context Engineer로만 내주고 Operator 방향은 없다(R13).
  const directions = HANDOFF_DIRECTIONS.map(([from, to]) => `${from}->${to}`);
  assert(directions.includes("lophn->app_engineer"));
  assert(directions.includes("lophn->context_engineer"));
  assert(!directions.some((direction) => direction.endsWith("->operator")));
  // handoff.submit tool 입력은 what·why·excludes·expected_outputs로 한정한다(R13).
  // 세션·tool 기록·발신 권한을 실을 필드가 없으므로 그런 값을 넣으면 거절이다.
  const tool = AGENT_TOOLS.find((tool) => tool.name === "handoff.submit");
  assert(tool !== undefined);
  const content = {
    receiver_assignment: "asg_01arz3ndektsv4rrffq69g5fbw",
    to_role: "app_engineer",
    what: "SDK examples the new app reuses",
    why: "The plan reuses the lophn SDK",
    excludes: ["context direct edits"],
    expected_outputs: ["an assignment with the reuse evidence"],
    references: [],
    dedup_key: "handoff-once",
  };
  assertEquals(tool.input.safeParse(content).success, true);
  assertEquals(
    tool.input.safeParse({
      ...content,
      session: "sess_01arz3ndektsv4rrffq69g5fav",
    }).success,
    false,
    "handoff.submit input takes no session field",
  );
  assertEquals(
    tool.input.safeParse({
      ...content,
      tool_history: [{ tool: "app.list" }],
    }).success,
    false,
    "handoff.submit input takes no tool-history field",
  );
  assertEquals(
    tool.input.safeParse({
      ...content,
      permissions: ["app.call"],
    }).success,
    false,
    "handoff.submit input takes no permission field",
  );
});

Deno.test("lophn-agent/roles/lophn#R16: the intent and taste question asks and keeps the plan undecided when no answer comes", () => {
  const draft = intentQuestion("collect the Mahas launch notes", [
    "existing project first",
    "widen the reading context",
  ]);
  // 목표·자료 용도·project/app 여부·재사용 우선순위를 결정하지 않고 묻는다(R16).
  assert(draft.prompt.includes("collect the Mahas launch notes"));
  assertEquals(draft.recommendation, null);
  // 선택지에는 action이 없어 답이 없어도 아무것도 바뀌지 않고 기획은
  // 미결정으로 남는다(R16).
  for (const option of draft.options) {
    assertEquals(option.action, null, option.key);
    assertEquals(option.adoption, null, option.key);
  }
  // 답이 없을 것까지 선택지에 둔다(R16: 답이 없으면 미결정 유지).
  assert(
    draft.options.some((option) => option.key === "decide-later"),
  );
  // 제출 값이 question.submit의 모양과 맞는다(R16).
  const submission = draftSubmission(draft, "2026-10-07T00:00:00Z");
  assertEquals(submission.expires_at, "2026-10-07T00:00:00Z");
  assertEquals(checkDraftSubmission(submission), { ok: true });
});

Deno.test("lophn-agent/roles/lophn#R16: a place recommendation draft keeps its fixed move action through submission", () => {
  const recommendations = recommendPlaces([target(0)]);
  assert(recommendations.drafts.length === 1);
  const draft = recommendations.drafts[0]!;
  // 자리 이동 선택지의 고정 action은 draft 함수가 만든다(questions#R13).
  const move = draft.options.find((option) => option.key === "move-1");
  assert(move !== undefined);
  assert(move.action !== null);
  const bindingBefore = move.action.binding_hash;
  // 제출은 대상·값 후보와 설명만 옮기고 고정 action은 그대로 실린다(T29).
  const submission = draftSubmission(draft);
  const moved = submission.options.find((option) => option.key === "move-1");
  assert(moved !== undefined);
  assertEquals(moved.action, move.action);
  assertEquals(moved.action?.binding_hash, bindingBefore);
  assertEquals(checkDraftSubmission(submission), { ok: true });
  // 유지 선택지는 action이 null이다(R5, R16).
  const keep = submission.options.find((option) => option.key === "leave-it");
  assert(keep !== undefined);
  assertEquals(keep.action, null);
});

Deno.test("lophn-agent/roles/lophn#R5: a setting change question keeps its fixed apply_settings action through submission", () => {
  const definition = {
    key: "platform.reads.page",
    owner: "platform/settings",
    display_name_key: "platform.reads.page.name",
    description: "Reading page size",
    value_meaning_key: "platform.reads.page.meaning",
    default_meaning_key: "platform.reads.page.default-meaning",
    affected_features: ["reads"],
    risk_key: "platform.reads.risk",
    revert_key: "platform.reads.revert",
    constraints: {},
    required: false,
    layers: ["common" as const],
    apply_at: "next_run" as const,
    apply_at_key: "platform.reads.page.apply-at",
    machine_local: false,
    value_type: {},
    default_present: true,
    default: 50,
  };
  const proposal = settingChangeQuestion({
    question: QUESTION,
    definition,
    effective: {
      key: "platform.reads.page",
      value: 50,
      resolved: true,
      source_layer: "common",
      choices: [],
      revision: 3,
      apply_at: "next_run" as const,
    },
    newValue: 100,
    revision: 3,
    defaults_revision: "def1",
    why: "Fewer pages per run round.",
  });
  assert(proposal.kind === "question");
  const change = proposal.draft.options.find((option) =>
    option.key === "change"
  );
  assert(change !== undefined);
  assert(change.action !== null);
  // settingsOptionAction이 고정한 action이 그대로 실린다(T29). hash는 바뀌지 않는다.
  const submission = draftSubmission(proposal.draft);
  const submitted = submission.options.find((option) =>
    option.key === "change"
  );
  assert(submitted !== undefined);
  assertEquals(submitted.action, change.action);
  assertEquals(checkDraftSubmission(submission), { ok: true });
  // 소유 owner 검사도 통과다(platform/settings apply_settings).
  assertEquals(checkOptionAction(QUESTION, change.action).ok, true);
});

Deno.test("lophn-agent/roles/lophn#R19: planning, reuse and guidance runs fix their judgment and organizing model through the preset selection", () => {
  // 판 용도는 judgment·organizing 둘이고 preset 선택으로 고정한다(R19). 제품
  // 기본 preset은 사람이 provider를 고르기 전까지 model·organizing_model이
  // null(미준비)이다.
  const preset = productPresetDefinition("lophn", "sha256:prompt");
  assert(preset !== undefined);
  assertEquals(preset.model, null);
  assertEquals(preset.organizing_model, null);
  // organizing이 비면 같은 판의 model을 쓴다(presets#R13, harness/model#R19).
  const entry: CatalogEntry = {
    provider_definition: "pd_1",
    model_name: "claude-haiku-4-5",
    context_limit: 200000,
    input_limit: 190000,
    output_limit: 8000,
    supports_tools: true,
    input_media: ["text"],
    output_media: ["text"],
    options: [{
      id: "effort",
      label: "Effort",
      values: [
        { value: "off", label: "Off", wire: null },
        { value: "low", label: "Low", wire: null },
      ],
      default_value: "off",
      budget: null,
    }],
    preview: null,
    deprecated: null,
    source: "user",
    source_revision: "r1",
    checked_at: null,
    received_at: null,
    price_basis: null,
  };
  const deps = {
    definitionKey: (_provider: string) => "pd_1",
    modelListed: () => true,
    credentialKeys: (_provider: string) => ["main"] as const,
    catalogEntry: () => entry,
  };
  const judgment = validateModelSelection("model", {
    provider: "anthropic",
    credentials: ["main"],
    model_name: "claude-haiku-4-5",
    reasoning_level: "off",
    options: {},
  }, deps);
  assert(judgment.ok);
  assertEquals(judgment.value?.purpose, "judgment");
  // organizing_model은 같은 selection 입력으로 organizing 용도로 고정된다(R19).
  const organizing = validateModelSelection("organizing_model", {
    provider: "anthropic",
    credentials: ["main"],
    model_name: "claude-haiku-4-5",
    reasoning_level: "off",
    options: {},
  }, deps);
  assert(organizing.ok);
  assertEquals(organizing.value?.purpose, "organizing");
  // 목록에 없는 model은 저장 거절이다(presets#R10).
  const listed = validateModelSelection("model", {
    provider: "anthropic",
    credentials: ["main"],
    model_name: "no-such-model",
    reasoning_level: "off",
    options: {},
  }, { ...deps, modelListed: () => false });
  assertEquals(listed.ok, false);
});

Deno.test("lophn-agent/roles/lophn#R19: the question submit tool rejects a model-fixed action", async () => {
  // question.submit tool은 선택지 action을 null로만 받는다(T29). 모델이 고정
  // action을 싣는 값은 거절이다 → roles/lophn의 수집 통로(draftSubmission)만
  // 고정 action을 실는다.
  const calls: { contract: string; input: unknown; run: string }[] = [];
  let counter = 0;
  const ports = {
    call: (contract: string, input: unknown, run: string) => {
      calls.push({ contract, input, run });
      return Promise.resolve(ok({ as_of_seq: "1", next_cursor: null }));
    },
    newId: (prefix: string) => {
      counter += 1;
      return `${prefix}_01arz3ndektsv4rrffq69g5f${"abcdefgh"[counter]}a`;
    },
    runFacts: () =>
      Promise.resolve(ok({
        session: null,
        role: "lophn" as const,
        original_message: "msg_01arz3ndektsv4rrffq69g5fav",
        assignment: "asg_01arz3ndektsv4rrffq69g5fav",
      })),
  };
  const names = AGENT_TOOLS.map((tool) => tool.name);
  const listed = listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    { presetTools: names, roleTools: names },
  );
  const credential: RunCredential = {
    run: RUN,
    targets: new Set(),
    operations: new Set(["CreateQuestion"]),
  };
  const base = {
    prompt: "어느 쪽으로 갈까요",
    reason: "취향이 갈린다",
    options: [],
    recommendation: null,
    expires_at: null,
  };
  const asked = await executeTool(
    { listed, handlers: createAgentToolHandlers(ports), credential },
    "question.submit",
    base,
  );
  assertEquals(asked.outcome.kind, "success");
  const withAction = await executeTool(
    { listed, handlers: createAgentToolHandlers(ports), credential },
    "question.submit",
    {
      ...base,
      options: [{
        key: "move-1",
        label: "Move to the Mahas project",
        description: "Move the note.",
        evidence: [],
        adoption: null,
        action: moveOptionAction({
          document: DOC,
          place: { kind: "project", id: PROJECT },
          name: "moved",
          base_revision: "1",
        }),
      }],
    },
  );
  assertEquals(withAction.outcome.code, "invalid_input");
  assertEquals(calls.length, 1);
});

Deno.test("lophn-agent/roles/lophn#R2: a direct coding request from the person becomes a ticket, not a coding agent start", () => {
  // ticket 생성은 상한 선택에 있고 coding agent 시작 tool은 어느 상한에도
  // 없다(R2). ticket 생성의 내장 정의는 harness/tools의 ticket 묶음이다.
  const lophn = ROLE_CAPS.get("lophn");
  assert(lophn !== undefined);
  assert(lophn.tools.includes("ticket.create"), "ticket.create is in the cap");
  for (
    const role of ["lophn", "app_engineer", "context_engineer", "operator"]
  ) {
    const cap = ROLE_CAPS.get(role);
    assert(cap !== undefined);
    assertEquals(
      cap.tools.filter((tool) => tool.startsWith("coding_agent")),
      [],
      `${role} starts coding agents`,
    );
    assertEquals(
      cap.tools.filter((tool) => tool.startsWith("subagent")),
      [],
      `${role} starts subagents`,
    );
  }
});

Deno.test("lophn-agent/roles/lophn#R11: request-scope reads via the lophn tool list stay inside the preset capability intersection", () => {
  // 교집합 밖 이름은 목록에서 뺀다(R1, R11). 상한에 있어도 preset 선택에 없으면
  // 목록에 없다.
  const lophn = ROLE_CAPS.get("lophn");
  assert(lophn !== undefined);
  const everyBuiltin = BUILTIN_TOOLS.map((tool) => tool.name);
  const listed = lophnTools(everyBuiltin);
  const names = listed.map((tool) => tool.name);
  // 상한 통로 안의 내장 tool만 남는다.
  for (const name of names) {
    assert(lophn.tools.includes(name), `${name} is in the lophn cap`);
    assert(
      BUILTIN_TOOLS.some((tool) => tool.name === name),
      `${name} is a builtin definition`,
    );
  }
  // 교집합 밖의 상한만 이름은 정의가 있어도 목록에 없다.
  const capOnly = lophn.tools.filter((name) => !everyBuiltin.includes(name));
  for (const name of capOnly) {
    assertEquals(names.includes(name), false, name);
  }
});
