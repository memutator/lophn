import { assert, assertEquals } from "@std/assert";
<<<<<<< HEAD
import {
  contextItemSchema,
  contextPerspectiveSchema,
} from "@lophn/contracts/documents";
=======
import type { CatalogEntry } from "@lophn/contracts/lophn-agent";
>>>>>>> origin/main
import {
  handoffAllowed,
  handoffContentSchema,
  handoffReferenceSchema,
} from "@lophn/contracts/lophn-agent";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  BUILTIN_TOOLS,
  createBuiltinToolHandlers,
  DOCUMENT_READ_TOOL_NAMES,
  executeTool,
  listTools,
  METADATA_TOOL_NAMES,
  type RunCredential,
  runOperations,
  type ToolDefinition,
} from "../../harness/tools/mod.ts";
<<<<<<< HEAD
import { ROLE_CAPS } from "../../agents/mod.ts";
import {
  CANDIDATE_DOCUMENT_MIN,
  CANDIDATE_EVIDENCE_LIMIT,
  candidateEvidence,
  candidateTerms,
  checkReport,
  choosePerspective,
  conflictHandoff,
  type DesignReport,
  designReport,
  holdWithoutAnswer,
  interpretationQuestion,
  PERSPECTIVES,
  purposeOf,
  REPORT_TERM_LIMIT,
  scopeLine,
} from "./mod.ts";
=======
import {
  APP_COMMAND_EXPOSURE,
  CONTEXT_ENGINEER_BUNDLE,
  productPresetDefinition,
  ROLE_CAPS,
  validateDefinition,
  type ValidateDeps,
} from "../../presets/mod.ts";
import { conflictHandoff, holdWithoutAnswer, purposeOf } from "./mod.ts";
>>>>>>> origin/main

// roles/context-engineer의 충돌 handoff·보류·model 용도(순수 규칙)와 역할 tool 선택,
// 기본 preset의 묶음, prompt가 부르는 tool, 문서 읽기 흐름을 본다. 실제 provider·사람 데이터 root는 열지 않는다. assignment 적용은
// 소유 concern의 시험이 본다.

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const RUN = id("run", 1);
const CALL = id("tcl", 1);
const DOC_A = id("doc", 1);
const DOC_B = id("doc", 2);
const DOC_C = id("doc", 3);
const VER_A = id("ver", 1);
const VER_B = id("ver", 2);
const VER_C = id("ver", 3);
const HASH = "a".repeat(64);

// --- 역할 tool 선택(R5, R6, R14, R15) ---

function listedForRole(): readonly ToolDefinition[] {
  const cap = ROLE_CAPS.get("context_engineer");
  assert(cap !== undefined);
  return listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    { presetTools: cap.tools, roleTools: cap.tools },
  );
}

const ABSENT_TOOLS = [
  // prompt 조립·cache·대화 압축은 tool이 아니라 preset·harness의 몫이다.
  "prompt.assemble",
  "context.compact",
  "cache.control",
  // 앱 기획·설계·코드·수리·티켓은 lophn·App Engineer의 몫이다.
  "app.plan",
  "app.design",
  "code.write",
  "code.edit",
  "problem.set_interpretation",
  "ticket.create",
  "ticket.list",
  "ticket.read",
  // 앱 command 실행은 노출 none이다(roles/common R11).
  "app.run",
  "app.call",
  "app.call_read_command",
  "app.command_metadata",
  // Operator 업무 대행과 승인 적용은 assignments 몫이다.
  "approval.apply_assignment",
  "assignment.create",
  // 원본 문서의 이동·이름 변경·삭제는 documents 사람 경로다.
  "document.move",
  "document.rename",
  "document.delete",
  // 지침 파일 쓰기와 secret·임의 파일도 없다.
  "instruction.write",
  "setting.write",
  "secret.read",
  "source.read",
  "file.read",
];

Deno.test("lophn-agent/roles/context-engineer#R6 [ctx-I58d]: 맡지 않는 일의 tool은 역할 상한과 제공 목록 어디에도 없다", () => {
  const cap = ROLE_CAPS.get("context_engineer")!;
  const list = listedForRole();
  const listedNames = new Set(list.map((tool) => tool.name));
  for (const absent of ABSENT_TOOLS) {
    assert(!cap.tools.includes(absent), `${absent} in role cap`);
    assert(!listedNames.has(absent), `${absent} in the listed set`);
  }
});

Deno.test("lophn-agent/roles/context-engineer#R6 [ctx-I58d]: 목록에 없는 변경 tool의 실행은 없는 tool과 같은 결과다", async () => {
  const { run } = rig(readWorld());
  for (
    const name of [
      "document.move",
      "document.rename",
      "document.delete",
      "app.run",
      "ticket.create",
      "approval.apply_assignment",
    ]
  ) {
    const outcome = await run(name, {});
    assertEquals(outcome.outcome.kind, "failure", name);
    assertEquals(outcome.outcome.code, "not_found", name);
    assertEquals(outcome.result.summary, "tool is not available", name);
    assertEquals(outcome.result.content, null, name);
  }
});

const CONTEXT_ENGINEER_TOOLS_ALL = [
  "context.create",
  "context.read_contract",
  "context.draft",
  "context.preview",
  "context.submit",
  "context.violations",
  "context.glossary_read",
  "context.glossary_write",
];

Deno.test("lophn-agent/roles/context-engineer#R14 [ctx-I58d]: 여덟 tool은 이 역할에게만 열리고 읽기 넷과 쓰기 넷으로 나뉜다", () => {
  const listed = new Map(listedForRole().map((tool) => [tool.name, tool]));
  for (const name of CONTEXT_ENGINEER_TOOLS_ALL) {
    assert(listed.has(name), name);
  }
  for (
    const name of [
      "context.read_contract",
      "context.preview",
      "context.violations",
      "context.glossary_read",
    ]
  ) {
    assertEquals(listed.get(name)!.effect, "read", name);
  }
  for (
    const name of [
      "context.create",
      "context.draft",
      "context.submit",
      "context.glossary_write",
    ]
  ) {
    assertEquals(listed.get(name)!.effect, "write", name);
  }
  // 개체 읽기와 다음 이름은 네 역할의 공통 읽기다.
  for (const [role, cap] of ROLE_CAPS) {
    for (const name of ["context.read_entity", "series.next_name"]) {
      assert(cap.tools.includes(name), `${role} ${name}`);
    }
    if (role === "context_engineer") continue;
    for (const name of CONTEXT_ENGINEER_TOOLS_ALL) {
      assert(!cap.tools.includes(name), `${role} ${name}`);
    }
  }
});

Deno.test("lophn-agent/roles/context-engineer#R5 [ctx-I58d]: 코드·shell·파일 쓰기·앱 command 실행 tool은 없고 context tool은 선언만 받는다", () => {
  const names = listedForRole().map((tool) => tool.name);
  for (const name of names) {
    assert(
      !/^(shell|code|file|http|web|browser|subagent|coding_agent)(\.|$)/
        .test(name),
      name,
    );
  }
  for (const forbidden of ["app.run", "app.call", "app.call_read_command"]) {
    assert(!names.includes(forbidden), forbidden);
  }
  // 앱 write command 실행 상한이 없다: 노출 효과가 비어 있다(roles/common R11).
  const exposure = APP_COMMAND_EXPOSURE.get("context_engineer")!;
  assertEquals(exposure.effects, []);
  assertEquals(exposure.execution, "none");
  // 초안은 JSON 객체로만 받는다. 문자열 코드는 입력 검사에서 걸린다.
  const draft = listedForRole().find((tool) => tool.name === "context.draft")!;
  assertEquals(
    draft.input.safeParse({ context: id("ctx", 1), content: "code" }).success,
    false,
  );
  assertEquals(
    draft.input.safeParse({ context: id("ctx", 1), content: { schema: 1 } })
      .success,
    true,
  );
});

function validateDeps(): ValidateDeps {
  return {
    bundles: TOOL_BUNDLES,
    mcpServers: new Map(),
    roleCaps: ROLE_CAPS,
    definitionKey: () => undefined,
    catalogEntry: () => undefined,
    modelListed: () => null,
    credentialKeys: () => [],
  };
}

Deno.test("lophn-agent/roles/context-engineer#R15 [ctx-I58d]: 기본 preset은 context-engineer 묶음을 고르고 펼친 목록이 역할 상한과 같다", () => {
  const preset = productPresetDefinition("context_engineer", HASH);
  assertEquals(preset.capability.bundles, [
    { name: CONTEXT_ENGINEER_BUNDLE, revision: 1 },
  ]);
  assertEquals(
    TOOL_BUNDLES.get(CONTEXT_ENGINEER_BUNDLE),
    CONTEXT_ENGINEER_TOOLS_ALL,
  );
  // 묶음에 든 동작은 직접 고른 목록에 다시 들지 않는다.
  const direct = preset.capability.tools.map((tool) => tool.tool);
  for (const name of CONTEXT_ENGINEER_TOOLS_ALL) {
    assert(!direct.includes(name), name);
  }
  // 묶음 + 직접 고른 동작이 역할 상한과 정확히 같다.
  const cap = ROLE_CAPS.get("context_engineer")!;
  assertEquals(
    [...TOOL_BUNDLES.get(CONTEXT_ENGINEER_BUNDLE)!, ...direct].sort(),
    [...cap.tools].sort(),
  );
  // 저장 검사를 통과하고 context는 전체를 읽는다(presets 기본 preset 표).
  const checked = validateDefinition(preset, validateDeps());
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(preset.context, [{ kind: "all", target: null, section: null }]);
  // 이 preset으로 이 run이 제공하는 목록에 여덟 tool이 모두 든다.
  const presetTools = [
    ...TOOL_BUNDLES.get(CONTEXT_ENGINEER_BUNDLE)!,
    ...direct,
  ];
  const listed = listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    { presetTools, roleTools: cap.tools },
  ).map((tool) => tool.name);
  for (const name of CONTEXT_ENGINEER_TOOLS_ALL) {
    assert(listed.includes(name), name);
  }
});

Deno.test("lophn-agent/roles/context-engineer#R15 [ctx-I58d]: 다른 역할의 preset이 context-engineer 묶음을 고르면 저장이 거절된다", () => {
  for (const kind of ["lophn", "app_engineer"] as const) {
    const preset = productPresetDefinition(kind, HASH);
    const result = validateDefinition({
      ...preset,
      capability: {
        bundles: [{ name: CONTEXT_ENGINEER_BUNDLE, revision: 1 }],
        tools: [],
      },
    }, validateDeps());
    assertEquals(result.ok, false, kind);
  }
});

Deno.test("lophn-agent/roles/context-engineer#R8 [ctx-I58d]: prompt는 여덟 tool을 만들기·초안·미리보기·제출 순서로 이름 붙이고 없는 tool이나 옛 개념을 쓰지 않는다", () => {
  const prompt = Deno.readTextFileSync(new URL("./prompt.md", import.meta.url));
  // 개체 읽기와 다음 이름은 선택한 context로 run마다 만들어져 정적 목록에 없고 역할 상한에 있다.
  const listed = new Set(ROLE_CAPS.get("context_engineer")!.tools);
  // 글에 이름으로 든 tool은 모두 이 역할의 상한에 있다.
  const quoted = [...prompt.matchAll(/`([a-z_]+\.[a-z_]+)`/g)].map((m) =>
    m[1]!
  );
  for (const name of quoted) assert(listed.has(name), `unknown tool ${name}`);
  for (const name of CONTEXT_ENGINEER_TOOLS_ALL) {
    assert(quoted.includes(name), `missing ${name}`);
  }
  for (const name of ["context.read_entity", "series.next_name"]) {
    assert(quoted.includes(name), `missing ${name}`);
  }
  const at = (name: string) => prompt.indexOf(`\`${name}\``);
  assert(at("context.create") < at("context.read_contract"));
  assert(at("context.read_contract") < at("context.draft"));
  assert(at("context.draft") < at("context.preview"));
  assert(at("context.preview") < at("context.submit"));
  // 옛 모델의 개념은 없다.
  for (const old of ["perspective", "용어 후보", "watch", "관점 선택"]) {
    assert(!prompt.includes(old), old);
  }
  // presets#R4: 맡는 일·맡지 않는 일·관점·기대 결과.
  for (
    const heading of [
      "## 맡는 일",
      "## 맡지 않는 일",
      "## 관점",
      "## 기대 결과",
    ]
  ) {
    assert(prompt.includes(heading), heading);
  }
});

// --- 문서 읽기 흐름(R7) --------------------------------------------------------

type Call = {
  contract: string;
  input: Record<string, unknown>;
  options: unknown;
};

// documents 읽기와 context·term 변경, 저장, 질문을 흉내 내는 메모리 world다. 실제
// core·documents worker 연결은 각 concern의 시험이 본다. model provider는 부르지 않는다.
function readWorld() {
  const calls: Call[] = [];
  const texts = new Map<string, string>([
    [`${DOC_A}@${VER_A}`, "본문 A의 ledger 설명이다."],
    [`${DOC_B}@${VER_B}`, "본문 B의 redaction 설명이다."],
    [`${DOC_C}@${VER_C}`, "본문 C의 snapshot 설명이다."],
  ]);
  const format = { name: "document", module_hash: HASH, explicit: false };
  return {
    calls,
    texts,
    call(
      contract: string,
      input: unknown,
      _run: string,
      options?: unknown,
    ): Promise<Result<unknown>> {
      const body = (input ?? {}) as Record<string, unknown>;
      calls.push({ contract, input: body, options });
      return Promise.resolve(handle(contract, body));
    },
    saved(): { text: string } | undefined {
      const call = calls.find((entry) => entry.contract === "SaveToolDocument");
      if (call === undefined) return undefined;
      return { text: String(call.input["text"]) };
    },
  };

  function handle(contract: string, body: Record<string, unknown>) {
    switch (contract) {
      case "outline.document": {
        const reference = body["reference"] as {
          document: string;
          version: string;
        };
        return ok({
          kind: "document",
          basis_seq: "1",
          document: reference.document,
          version: reference.version,
          latest_version: reference.version,
          format,
          module_hash: HASH,
          section_status: "complete",
          failure_reason: null,
          file: null,
          entries: [usageEntry(reference.version)],
          complete: true,
          next_cursor: null,
        });
      }
      case "document.read": {
        const reference = body["reference"] as {
          document: string;
          version: string;
        };
        const text = texts.get(`${reference.document}@${reference.version}`);
        if (text === undefined) {
          return err({
            code: "not_found" as const,
            message: "no such version",
          });
        }
        return ok({
          as_of_seq: "1",
          document: reference.document,
          version: reference.version,
          latest_version: reference.version,
          format,
          module_hash: HASH,
          section: body["section"] ?? null,
          section_status: body["section"] == null ? "whole" : "complete",
          include_children: body["include_children"] === true,
          ranges: [{ start_line: 2, end_line: 2 }],
          text,
          redacted: false,
          failure_reason: null,
          omission_reason: null,
          file: null,
          complete: true,
          next_cursor: null,
        });
      }
      case "search.query": {
        return ok({
          as_of_seq: "1",
          results: [{
            document: DOC_B,
            version: VER_B,
            latest_version: VER_B,
            format,
            module_hash: HASH,
            section: "usage",
            ranges: [{ start_line: 2, end_line: 2 }],
            reference: { document: DOC_B, version: VER_B, section: "usage" },
            title: "사용법",
            snippet: "본문 B의 redaction 설명이다.",
            score: 1,
            match_source: "original",
            cache_basis: null,
          }],
          coverage: {
            state: "complete",
            lagging: false,
            processed_seq: "1",
            ledger_basis_seq: "1",
          },
          complete: true,
          next_cursor: null,
        });
      }
      case "SaveToolDocument": {
        return ok({
          status: "saved",
          document: String(body["document"]),
          version: VER_A,
          reference: `${String(body["document"])}${
            body["base_version"] == null ? "" : ""
          }`,
          event_seq: "2",
          warnings: [],
        });
      }
      case "CreateQuestionGroup": {
        return ok({ id: body["id"], status: "open" });
      }
      case "SubmitHandoff": {
        return ok({ receiver_run: body["receiver_run"], status: "sent" });
      }
      default:
        return err({ code: "invalid_input" as const, message: contract });
    }
  }
}

function usageEntry(version: string) {
  return {
    key: "usage",
    title: "사용법",
    parent: null,
    position: 1,
    level: 1,
    anchor: "usage",
    characters: 21,
    body_hash: HASH,
    own_ranges: [{ start_line: 2, end_line: 2 }],
    subtree_range: { start_line: 2, end_line: 2 },
    version,
    estimated_tokens: 7,
    children_count: 0,
    hidden_children_count: 0,
  };
}

function rig(world: ReturnType<typeof readWorld>) {
  const cap = ROLE_CAPS.get("context_engineer")!;
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
        role: "context_engineer" as const,
        original_message: id("msg", 1),
        assignment: "asg_01arz3ndektsv4rrffq69g5fav",
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
  return { world, listed, run };
}

function kind(
  outcome: Awaited<ReturnType<ReturnType<typeof rig>["run"]>>,
): string {
  return outcome.outcome.kind;
}

Deno.test("lophn-agent/roles/context-engineer#R7 [ctx-I58d]: 목차를 먼저 읽고 필요한 section만 본문으로 펼친다", async () => {
  const world = readWorld();
  const { run } = rig(world);
  const outline = await run("document.outline", {
    reference: { document: DOC_A, version: VER_A, section: null },
  });
  assertEquals(kind(outline), "success");
  // 목차의 항목 하나가 이번 판단의 범위다(R7).
  const entries =
    (outline.result.content as { entries?: unknown[] })["entries"];
  assertEquals(entries, [usageEntry(VER_A)]);
  const section = await run("document.read_section", {
    reference: { document: DOC_A, version: VER_A, section: null },
    section: "usage",
  });
  assertEquals(kind(section), "success");
  // 전체 version 읽기(section 없는 document.read)는 부르지 않았다(R7).
  const wholeReads = world.calls.filter((call) =>
    call.contract === "document.read" && call.input["section"] === null
  );
  assertEquals(wholeReads.length, 0);
  const sectionReads = world.calls.filter((call) =>
    call.contract === "document.read" && call.input["section"] === "usage"
  );
  assertEquals(sectionReads.length, 1);
});

Deno.test("lophn-agent/roles/context-engineer#R7 [ctx-I58d]: 검색 뒤 필요한 section만 읽고 실제 근거 판이 남는다", async () => {
  const world = readWorld();
  const { run } = rig(world);
  const search = await run("document.search", { query: "redaction" });
  assertEquals(kind(search), "success");
  const section = await run("document.read_section", {
    reference: { document: DOC_B, version: VER_B, section: null },
    section: "usage",
  });
  assertEquals(kind(section), "success");
  // 근거 판은 고정 version·section·줄 범위를 가리킨다(R7).
  assertEquals(section.result.source, {
    target: `${DOC_B}#usage`,
    version: VER_B,
    range: "2-2",
    original_bytes: 35,
    original_lines: 1,
    omitted_count: null,
  });
  assertEquals(
    (section.result.content as { text?: string })["text"],
    "본문 B의 redaction 설명이다.",
  );
});

Deno.test("lophn-agent/roles/context-engineer#R7 [ctx-I58d]: 읽기 tool은 목차·검색·본문 셋·목록·이력·차이를 읽기로만 준다", () => {
  const cap = ROLE_CAPS.get("context_engineer")!;
  assertEquals(DOCUMENT_READ_TOOL_NAMES, [
    "document.list",
    "document.outline",
    "document.search",
    "document.read_version",
    "document.read_section",
    "document.read_range",
    "document.history",
    "document.diff",
  ]);
  for (const tool of DOCUMENT_READ_TOOL_NAMES) {
    assert(cap.tools.includes(tool), tool);
  }
  for (const tool of METADATA_TOOL_NAMES) {
    assert(cap.tools.includes(tool), tool);
  }
  // 앱 목적 읽기는 이름·목적·상태 조회만이다(R14). command 실행은 없다.
  assert(cap.tools.includes("app.list"));
  assert(cap.tools.includes("app.read_purpose"));
  assert(!cap.tools.includes("app.run"));
});

// --- 충돌(R12) --------------------------------------------------------

function occurrence(
  document: string,
  version: string,
  section: string | null = "usage",
) {
  return {
    document,
    version,
    section,
    start_line: null,
    end_line: null,
  };
}

Deno.test("lophn-agent/roles/context-engineer#R12 [ctx-I58d]: 같은 말 다른 뜻은 충돌로 구별해 lophn에 넘기고 용어를 합치지 않는다", () => {
  const conflicts = { name: "ledger", other: "cache" };
  const draft = conflictHandoff({
    name: conflicts.name,
    other: conflicts.other,
    context: id("ctx", 11),
    evidence: [occurrence(DOC_A, VER_A), occurrence(DOC_B, VER_B)],
    question: `"${conflicts.name}"과 "${conflicts.other}"의 뜻을 정해 주세요`,
  });
  // 충돌의 기획 판단은 lophn이다(R12).
  assertEquals(draft.to_role, "lophn");
  assertEquals(handoffAllowed("context_engineer", "lophn"), true);
  // handoff는 lophn-agent/handoff의 고정 근거 모양을 쓴다(R12).
  for (const reference of draft.references) {
    assert(handoffReferenceSchema.safeParse(reference).success);
    assertEquals(reference.question, null);
  }
  const content = handoffContentSchema.safeParse(draft.content);
  assert(content.success, JSON.stringify(content.error));
  assert(draft.content.what.includes(conflicts.name));
  // 사람의 뜻 없이 합치지 않는다(R12).
  assert(
    draft.content.excludes.some((exclusion) => exclusion.includes("병합")),
  );
});

// --- 보류(R10) --------------------------------------------------------

<<<<<<< HEAD
Deno.test("lophn-agent/roles/context-engineer#R10: 답이 없으면 변경을 보류하고 정의로 적용하지 않는다", () => {
  const hold = holdWithoutAnswer("ledger", id("qgr", 3), [
    "term.propose_candidate",
    "candidate merge",
=======
Deno.test("lophn-agent/roles/context-engineer#R10 [ctx-I58d]: 답이 없으면 변경을 보류하고 정의로 적용하지 않는다", () => {
  const hold = holdWithoutAnswer("ledger", id("qst", 3), [
    "contract submit",
    "glossary merge",
>>>>>>> origin/main
  ]);
  assertEquals(hold, {
    name: "ledger",
    reason: "no_answer",
<<<<<<< HEAD
    group: id("qgr", 3),
    held_changes: ["term.propose_candidate", "candidate merge"],
=======
    question: id("qst", 3),
    held_changes: ["contract submit", "glossary merge"],
>>>>>>> origin/main
  });
});

Deno.test("lophn-agent/roles/context-engineer#R10 [ctx-I58d]: 필요한 결정은 질문으로 묶고 답이 없으면 그 질문 참조로 보류를 남긴다", async () => {
  const world = readWorld();
  const { run } = rig(world);
  const asked = await run("question.submit", {
    questions: [{
      prompt: "두 말의 뜻을 정해 주세요",
      reason: "같은 문서에 두 뜻이 함께 나타난다",
      options: [{
        key: "keep-ledger",
        label: "ledger로 정한다",
        description: "ledger를 올바른 말로 쓴다.",
        evidence: [{ document: DOC_A, version: VER_A, section: "usage" }],
        adoption: null,
        action: null,
      }],
      recommendation: null,
    }],
    expires_at: null,
  });
  assertEquals(kind(asked), "success");
  // 질문은 소유 contract(CreateQuestionGroup)로 묶음 하나로 넘어갔다.
  assertEquals(
    world.calls.filter((call) => call.contract === "CreateQuestionGroup")
      .length,
    1,
  );
<<<<<<< HEAD
  // 답이 없으면 이 질문 묶음의 참조로 보류한다(R10).
  const hold = holdWithoutAnswer("ledger", id("qgr", 9), [
    "term.propose_candidate",
=======
  // 답이 없으면 이 질문의 참조로 보류한다(R10).
  const hold = holdWithoutAnswer("ledger", id("qst", 9), [
    "contract submit",
>>>>>>> origin/main
  ]);
  assertEquals(hold.group, id("qgr", 9));
  assertEquals(hold.reason, "no_answer");
});

// --- judgment·organizing 용도(R20) --------------------------------------------------------

<<<<<<< HEAD
Deno.test("lophn-agent/roles/context-engineer#R14: 판단의 본문은 judgment, 정해진 보고 제목·요약은 organizing이다", () => {
  // 목적·경계·관점·term 해석의 본문은 judgment 용도다(R14).
  assertEquals(purposeOf("design_body"), "judgment");
  assertEquals(purposeOf("term_interpretation"), "judgment");
  // 이미 정한 보고 제목·요약은 organizing 용도다(R14).
=======
function catalogEntryFixture(over: Partial<CatalogEntry> = {}): CatalogEntry {
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
    ...over,
  };
}

Deno.test("lophn-agent/roles/context-engineer#R20 [ctx-I58d]: 판단의 본문은 judgment, 정해진 보고 제목·요약은 organizing이다", () => {
  // 목적·경계·관점·term 해석의 본문은 judgment 용도다(R20).
  for (
    const call of [
      "boundary",
      "contract",
      "search",
      "term_interpretation",
      "operator_design",
    ] as const
  ) {
    assertEquals(purposeOf(call), "judgment", call);
  }
  // 이미 정한 보고 제목·요약은 organizing 용도다(R20).
>>>>>>> origin/main
  assertEquals(purposeOf("report_title"), "organizing");
  assertEquals(purposeOf("report_summary"), "organizing");
});

<<<<<<< HEAD
// --- 설계 보고와 근거 자리(R1) --------------------------------------------------------

Deno.test("lophn-agent/roles/context-engineer#R1: 설계 요청이 이유·고정 근거·책임 경계가 있는 구성을 남긴다", () => {
  const line = scopeLine(
    { kind: "document", document: DOC_A, section: "usage" },
    "basis",
    "\n컨텍스트 목적의\n 책임 근거다  ",
  );
  assert(line !== undefined);
  const evidence = candidateEvidence([
    occurrence(DOC_A, VER_A),
    occurrence(DOC_B, VER_B),
    occurrence(DOC_C, VER_C),
  ]);
  const report = designReport({
    context: id("ctx", 21),
    purpose: "지침 문서의 용어를 다듬는다",
    scope: [line],
    confirmed: ["ledger"],
    undecided: ["arrange"],
    boundaries: ["원본 문서를 고치지 않는다", "앱 command를 실행하지 않는다"],
  });
  // 이유는 한 줄이고 근거는 고정 참조다(R1, R3).
  assertEquals(report.scope[0]!.reason, "컨텍스트 목적의 책임 근거다");
  assertEquals(evidence, [
    { document: DOC_A, version: VER_A, section: "usage" },
    { document: DOC_B, version: VER_B, section: "usage" },
    { document: DOC_C, version: VER_C, section: "usage" },
  ]);
  assertEquals(report.terms.confirmed, ["ledger"]);
  assertEquals(report.terms.undecided, ["arrange"]);
  assertEquals(report.boundaries, [
    "원본 문서를 고치지 않는다",
    "앱 command를 실행하지 않는다",
  ]);
  assertEquals(checkReport(report), { ok: true, problems: [] });
});

Deno.test("lophn-agent/roles/context-engineer#R1: 목적·관점·이유를 가진 컨텍스트를 생성하고 항목의 근거가 남는다", async () => {
  const world = readWorld();
  const { run } = rig(world);
  const created = await run("context.create", {
    title: "지침 용어 정리",
    purpose: "지침 문서의 용어를 다듬는다",
    items: [{
      target: { kind: "document", document: DOC_A, section: "usage" },
      perspective: "basis",
      reason: "책임 근거다",
    }],
  });
  assertEquals(kind(created), "success");
  // 생성의 목적·항목·관점·이유는 소유 contract로 그대로 넘어갔다(R1, R6).
  const createCall = world.calls.find((call) =>
    call.contract === "context.create"
  );
  assert(createCall !== undefined);
  const body = createCall.input as {
    purpose: string;
    items: { perspective: string; reason: string }[];
  };
  assertEquals(body.purpose, "지침 문서의 용어를 다듬는다");
  assertEquals(body.items[0]!.perspective, "basis");
  assertEquals(body.items[0]!.reason, "책임 근거다");
});

Deno.test("lophn-agent/roles/context-engineer#R1: 책임 밖 요청은 보고의 경계로 안내되고 해당 변경 tool은 없다", () => {
  const cap = ROLE_CAPS.get("context_engineer")!;
  // 안내는 보고의 경계(맡지 않는 일)로 남는다(R2).
  const report = designReport({
    context: id("ctx", 22),
    purpose: "정리한다",
    scope: [],
    confirmed: ["ledger"],
    undecided: [],
    boundaries: [
      "문서 이동·이름 변경·삭제는 documents 사람 경로로 안내한다",
      "앱 기획과 코드는 lophn·App Engineer의 몫이다",
    ],
  });
  assertEquals(report.boundaries.length, 2);
  assertEquals(checkReport(report).ok, true);
  // 그 요청의 변경 tool은 목록 어디에도 없다(R1).
  for (
    const absent of ["document.move", "document.rename", "document.delete"]
  ) {
    assert(!cap.tools.includes(absent), absent);
  }
=======
Deno.test("lophn-agent/roles/context-engineer#R20 [ctx-I58d]: 실제 model 선택은 preset의 두 용도로 검증된다", () => {
  const deps: ValidateDeps = {
    bundles: TOOL_BUNDLES,
    mcpServers: new Map(),
    roleCaps: ROLE_CAPS,
    definitionKey: (provider) =>
      provider === id("pvd", 1) ? "anthropic" : undefined,
    modelListed: (_definition, modelName) => modelName === "claude-haiku-4-5",
    credentialKeys: (provider) => provider === id("pvd", 1) ? ["key-main"] : [],
    catalogEntry: (_definition, modelName) =>
      modelName === "claude-haiku-4-5" ? catalogEntryFixture() : undefined,
  };
  const selection = {
    provider: id("pvd", 1),
    credentials: ["key-main"],
    model_name: "claude-haiku-4-5",
    reasoning_level: "medium" as const,
    options: {},
  };
  const judgment = validateDefinition({
    ...productPresetDefinition("context_engineer", HASH),
    model: selection,
    organizing_model: null,
  }, deps);
  assert(judgment.ok, JSON.stringify(judgment));
  assertEquals(judgment.value.model!.purpose, "judgment");
  assertEquals(judgment.value.organizing_model, null);
  const both = validateDefinition({
    ...productPresetDefinition("context_engineer", HASH),
    model: selection,
    organizing_model: { ...selection, reasoning_level: "low" as const },
  }, deps);
  assert(both.ok, JSON.stringify(both));
  assertEquals(both.value.model!.purpose, "judgment");
  assertEquals(both.value.organizing_model!.purpose, "organizing");
  // 두 용도는 서로 다른 선택으로 분리된다(R20).
  assertEquals(both.value.model!.reasoning_level, "medium");
  assertEquals(both.value.organizing_model!.reasoning_level, "low");
});

Deno.test("lophn-agent/roles/context-engineer#R20 [ctx-I58d]: 확인되지 않은 model은 저장을 거절하고 역할 상한은 model 호출 tool을 두지 않는다", () => {
  // 확인된 항목이 없으면 사용할 수 없다(R20의 preset 경로).
  const deps: ValidateDeps = {
    bundles: TOOL_BUNDLES,
    mcpServers: new Map(),
    roleCaps: ROLE_CAPS,
    definitionKey: () => "anthropic",
    modelListed: () => true,
    credentialKeys: () => ["key-main"],
    catalogEntry: () => undefined,
  };
  const result = validateDefinition({
    ...productPresetDefinition("context_engineer", HASH),
    model: {
      provider: id("pvd", 1),
      credentials: ["key-main"],
      model_name: "claude-haiku-4-5",
      reasoning_level: "medium",
      options: {},
    },
    organizing_model: null,
  }, deps);
  assert(!result.ok);
  assertEquals(result.error.code, "invalid_input");
  // 실제 model·계정은 preset 선택의 몫이다. 역할 상한은 model 호출 tool을 두지 않는다(R20).
  const cap = ROLE_CAPS.get("context_engineer")!;
  assertEquals(
    cap.tools.some((tool) =>
      tool.startsWith("model.") || tool.startsWith("provider.")
    ),
    false,
  );
  // 역할 상한도 model 이름을 고정하지 않는다(R20).
  assertEquals(
    cap.tools.some((tool) => tool.includes("claude") || tool.includes("gpt")),
    false,
  );
});

Deno.test("lophn-agent/roles/context-engineer#R8 [ctx-I58f]: prompt는 대상 context가 없으면 context.create로 먼저 만들라고 하고 만드는 tool이 없다는 옛 글은 없다", () => {
  const prompt = Deno.readTextFileSync(new URL("./prompt.md", import.meta.url));
  assert(prompt.includes("`context.create`"));
  assert(!prompt.includes("새로 만드는 tool은 없다"));
  const first = prompt.indexOf("`context.create`");
  assert(first < prompt.indexOf("`context.read_contract`"));
  // 만드는 일은 역할 상한에 있는 write 동작이다.
  const listed = new Map(listedForRole().map((tool) => [tool.name, tool]));
  assertEquals(listed.get("context.create")?.effect, "write");
>>>>>>> origin/main
});
