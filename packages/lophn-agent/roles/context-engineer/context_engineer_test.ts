import { assert, assertEquals } from "@std/assert";
import {
  contextItemSchema,
  contextPerspectiveSchema,
} from "@lophn/contracts/documents";
import type { CatalogEntry } from "@lophn/contracts/lophn-agent";
import {
  fixedVersionReferenceSchema,
  handoffAllowed,
  handoffContentSchema,
  handoffReferenceSchema,
  questionOptionSchema,
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
  TOOL_BUNDLES,
  type ToolDefinition,
} from "../../harness/tools/mod.ts";
import {
  productPresetDefinition,
  validateDefinition,
  type ValidateDeps,
} from "../../presets/mod.ts";
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

// roles/context-engineer의 설계 보고·용어 후보·관점 선택(순수 규칙)과 역할 tool 선택,
// 문서 읽기 흐름을 본다. 실제 provider·사람 데이터 root는 열지 않는다. 정의 확정
// (term.define)과 assignment 적용은 소유 concern의 시험이 본다.

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
const PROJECT = id("prj", 1);
const HASH = "a".repeat(64);

// --- 역할 tool 선택(R2) --------------------------------------------------------

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

Deno.test("lophn-agent/roles/context-engineer#R2: 맡지 않는 일의 tool은 역할 상한과 내장 정의 어디에도 없다", () => {
  const cap = ROLE_CAPS.get("context_engineer")!;
  const list = listedForRole();
  const listedNames = new Set(list.map((tool) => tool.name));
  const builtinNames = new Set(BUILTIN_TOOLS.map((tool) => tool.name));
  for (const absent of ABSENT_TOOLS) {
    assert(!cap.tools.includes(absent), `${absent} in role cap`);
    assert(!listedNames.has(absent), `${absent} in the listed set`);
    assert(!builtinNames.has(absent), `${absent} in builtin tools`);
  }
});

Deno.test("lophn-agent/roles/context-engineer#R2: 목록에 없는 변경 tool의 실행은 없는 tool과 같은 결과다", async () => {
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

Deno.test("lophn-agent/roles/context-engineer#R2: 정리는 읽기와 되돌릴 수 있는 쓰기 안에서 이루어지고 소유 contract를 가진다", () => {
  const cap = ROLE_CAPS.get("context_engineer")!;
  for (
    const present of [
      "document.outline",
      "document.read_section",
      "document.create",
      "document.save_version",
      "context.create",
      "context.rename",
      "context.set_purpose",
      "context.archive",
      "context.add_item",
      "context.update_item",
      "context.remove_item",
      "term.propose_candidate",
      "term.update_candidate",
      "term.remove_candidate",
      "question.submit",
      "handoff.submit",
    ]
  ) {
    assert(cap.tools.includes(present), present);
  }
  // 제공된 tool 하나는 소유 contract 하나다(R2).
  for (const definition of listedForRole()) {
    assert(definition.contract !== "", definition.name);
  }
});

// --- 문서 읽기 흐름(R3) --------------------------------------------------------

type Call = {
  contract: string;
  input: Record<string, unknown>;
  options: unknown;
};

// documents 읽기와 context·term 변경, 저장, 질문을 흉내 내는 메모리 world다. 실제
// core·documents worker 연결은 각 concern의 시험이 본다. model provider는 부르지 않는다.
function readWorld() {
  const calls: Call[] = [];
  const createdContexts: string[] = [];
  const createdTerms: string[] = [];
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
    created(ctx: string): boolean {
      return createdContexts.includes(ctx);
    },
    term(ctx: string): boolean {
      return createdTerms.includes(ctx);
    },
    proposed(): { name: string; evidence: number } | undefined {
      const call = calls.find((entry) => entry.contract === "term.propose");
      if (call === undefined) return undefined;
      return {
        name: String(call.input["name"]),
        evidence: ((call.input["evidence"] as unknown[]) ?? []).length,
      };
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
      case "context.create": {
        if (createdContexts.includes(String(body["id"]))) {
          return err({ code: "conflict" as const, message: "exists" });
        }
        createdContexts.push(String(body["id"]));
        return ok({
          ...body,
          revision: "11",
          status: "active",
        });
      }
      case "term.propose": {
        if (createdTerms.includes(String(body["id"]))) {
          return err({ code: "conflict" as const, message: "exists" });
        }
        createdTerms.push(String(body["id"]));
        return ok({
          ...body,
          revision: "12",
          status: "active",
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

Deno.test("lophn-agent/roles/context-engineer#R3: 목차를 먼저 읽고 필요한 section만 본문으로 펼친다", async () => {
  const world = readWorld();
  const { run } = rig(world);
  const outline = await run("document.outline", {
    reference: { document: DOC_A, version: VER_A, section: null },
  });
  assertEquals(kind(outline), "success");
  // 목차의 항목 하나가 이번 판단의 범위다(R3).
  const entries =
    (outline.result.content as { entries?: unknown[] })["entries"];
  assertEquals(entries, [usageEntry(VER_A)]);
  const section = await run("document.read_section", {
    reference: { document: DOC_A, version: VER_A, section: null },
    section: "usage",
  });
  assertEquals(kind(section), "success");
  // 전체 version 읽기(section 없는 document.read)는 부르지 않았다(R3).
  const wholeReads = world.calls.filter((call) =>
    call.contract === "document.read" && call.input["section"] === null
  );
  assertEquals(wholeReads.length, 0);
  const sectionReads = world.calls.filter((call) =>
    call.contract === "document.read" && call.input["section"] === "usage"
  );
  assertEquals(sectionReads.length, 1);
});

Deno.test("lophn-agent/roles/context-engineer#R3: 검색 뒤 필요한 section만 읽고 실제 근거 판이 남는다", async () => {
  const world = readWorld();
  const { run } = rig(world);
  const search = await run("document.search", { query: "redaction" });
  assertEquals(kind(search), "success");
  const section = await run("document.read_section", {
    reference: { document: DOC_B, version: VER_B, section: null },
    section: "usage",
  });
  assertEquals(kind(section), "success");
  // 근거 판은 고정 version·section·줄 범위를 가리킨다(R3).
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

Deno.test("lophn-agent/roles/context-engineer#R3: 읽기 tool은 목차·검색·본문 셋·목록·이력·차이를 읽기로만 준다", () => {
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
  // 앱 목적 읽기는 이름·목적·상태 조회만이다(R2). command 실행은 없다.
  assert(cap.tools.includes("app.list"));
  assert(cap.tools.includes("app.read_purpose"));
  assert(!cap.tools.includes("app.run"));
});

// --- 관점 선택(R6) --------------------------------------------------------

Deno.test("lophn-agent/roles/context-engineer#R6: 목적의 근거로 기준·참고·watch를 고른다", () => {
  assertEquals(PERSPECTIVES, ["basis", "reference", "watch"]);
  // 책임 근거는 기준, 배경 지식은 참고, 변화 추적 자료는 watch다(R6).
  assertEquals(
    choosePerspective({
      responsible_evidence: true,
      background_knowledge: false,
      change_tracking: false,
    }),
    "basis",
  );
  assertEquals(
    choosePerspective({
      responsible_evidence: false,
      background_knowledge: true,
      change_tracking: false,
    }),
    "reference",
  );
  assertEquals(
    choosePerspective({
      responsible_evidence: false,
      background_knowledge: false,
      change_tracking: true,
    }),
    "watch",
  );
  // 근거가 겹치면 책임 근거가 이기고, 근거가 없으면 고르지 않는다.
  assertEquals(
    choosePerspective({
      responsible_evidence: true,
      background_knowledge: true,
      change_tracking: true,
    }),
    "basis",
  );
  assertEquals(
    choosePerspective({
      responsible_evidence: false,
      background_knowledge: false,
      change_tracking: false,
    }),
    undefined,
  );
});

Deno.test("lophn-agent/roles/context-engineer#R6: 같은 문서를 두 컨텍스트에 다른 관점으로 연결하고 한 줄 이유를 남긴다", () => {
  const first = scopeLine(
    { kind: "document", document: DOC_A, section: null },
    "basis",
    "컨텍스트 목적의\n 책임 근거다.  ",
  );
  const second = scopeLine(
    { kind: "document", document: DOC_A, section: null },
    "watch",
    "변화만 따라간다",
  );
  assert(first !== undefined);
  assert(second !== undefined);
  assertEquals(first.perspective, "basis");
  assertEquals(second.perspective, "watch");
  assertEquals(first.reason, "컨텍스트 목적의 책임 근거다.");
  // 항목은 documents/contexts의 모양으로 통과한다(적용 계약).
  for (const line of [first, second]) {
    const checked = contextItemSchema.safeParse({
      target: line.target,
      perspective: line.perspective,
      reason: line.reason,
    });
    assert(checked.success, JSON.stringify(checked.error));
  }
  const designA = designReport({
    context: id("ctx", 1),
    purpose: "용어를 정리한다",
    scope: [first],
    confirmed: [],
    undecided: [],
    boundaries: ["문서를 고치지 않는다"],
  });
  const designB = designReport({
    context: id("ctx", 2),
    purpose: "변화를 따라간다",
    scope: [second],
    confirmed: [],
    undecided: [],
    boundaries: ["문서를 고치지 않는다"],
  });
  // 같은 문서도 컨텍스트마다 다르게 판단된다(R6).
  assertEquals(designA.scope[0]!.perspective, "basis");
  assertEquals(designB.scope[0]!.perspective, "watch");
});

Deno.test("lophn-agent/roles/context-engineer#R6: 관점 값은 documents/contexts의 값이다", () => {
  for (const perspective of PERSPECTIVES) {
    assert(
      contextPerspectiveSchema.safeParse(perspective).success,
      perspective,
    );
  }
});

// --- 설계 보고(R7) --------------------------------------------------------

Deno.test("lophn-agent/roles/context-engineer#R7: 보고는 목적·범위·용어·경계 네 부분을 담는다", () => {
  const report = designReport({
    context: id("ctx", 5),
    purpose: "지침 문서의 용어를 다듬는다",
    scope: [
      scopeLine(
        { kind: "document", document: DOC_A, section: "usage" },
        "basis",
        "책임 근거다",
      ),
      scopeLine(
        { kind: "document", document: DOC_B, section: null },
        "reference",
        "배경 지식이다",
      ),
      undefined,
    ],
    confirmed: ["ledger", "snapshot", "redaction"],
    undecided: ["arrange"],
    boundaries: [
      "원본 문서를 고치지   않는다",
      "",
      "앱 command를 실행하지   않는다",
    ],
  });
  // 정제되지 않은 범위는 빠지고 이유는 한 줄로 접힌다(R7).
  assertEquals(report.scope.length, 2);
  assertEquals(report.scope[0], {
    target: { kind: "document", document: DOC_A, section: "usage" },
    perspective: "basis",
    reason: "책임 근거다",
  });
  assertEquals(report.terms.confirmed, ["ledger", "snapshot", "redaction"]);
  assertEquals(report.terms.undecided, ["arrange"]);
  assertEquals(report.boundaries, [
    "원본 문서를 고치지 않는다",
    "앱 command를 실행하지 않는다",
  ]);
  assertEquals(checkReport(report), { ok: true, problems: [] });
});

Deno.test("lophn-agent/roles/context-engineer#R7: 사람이 받아들인 용어는 최대 30개이고 미정 후보는 별도다", () => {
  assertEquals(REPORT_TERM_LIMIT, 30);
  const confirmed = Array.from(
    { length: REPORT_TERM_LIMIT + 5 },
    (_, index) => `term-${index + 1}`,
  );
  const report = designReport({
    context: id("ctx", 6),
    purpose: "용어를 정리한다",
    scope: [],
    confirmed,
    undecided: confirmed.slice(0, 3),
    boundaries: ["문서를 고치지 않는다"],
  });
  assertEquals(report.terms.confirmed.length, 30);
  // 미정 후보는 확정 목록에 섞이지 않고 별도다(R7).
  for (const name of confirmed.slice(0, 3)) {
    assertEquals(report.terms.confirmed.includes(name), false, name);
  }
  assertEquals(report.terms.undecided.length, 3);
  assertEquals(checkReport(report).ok, true);
});

Deno.test("lophn-agent/roles/context-engineer#R7: 검사는 섞인 용어·없는 경계·빈 목적을 거절한다", () => {
  // 검사는 조립 전의 섞인 모양도 본다: designReport는 중복을 빼므로 직접 만든다.
  const mixed: DesignReport = {
    context: id("ctx", 7),
    purpose: "정리한다",
    scope: [],
    terms: { confirmed: ["ledger", "cache"], undecided: ["cache"] },
    boundaries: ["수리하지 않는다"],
  };
  const mixedChecked = checkReport(mixed);
  assertEquals(mixedChecked.ok, false);
  assert(mixedChecked.problems.includes("undecided term kept in confirmed"));
  const emptyBoundary = designReport({
    context: id("ctx", 7),
    purpose: "정리한다",
    scope: [],
    confirmed: ["ledger"],
    undecided: [],
    boundaries: ["", "   "],
  });
  const boundaryChecked = checkReport(emptyBoundary);
  assertEquals(boundaryChecked.ok, false);
  assert(boundaryChecked.problems.includes("boundary missing"));
  const blankPurpose = designReport({
    context: id("ctx", 7),
    purpose: "   ",
    scope: [],
    confirmed: ["ledger"],
    undecided: [],
    boundaries: ["수리하지 않는다"],
  });
  const purposeChecked = checkReport(blankPurpose);
  assertEquals(purposeChecked.ok, false);
  assert(purposeChecked.problems.includes("purpose missing"));
});

Deno.test("lophn-agent/roles/context-engineer#R7: 설계 보고는 문서로 저장되고 근거 판이 남는다", async () => {
  const world = readWorld();
  const { run } = rig(world);
  const report: DesignReport = designReport({
    context: id("ctx", 8),
    purpose: "용어를 다듬는다",
    scope: [
      scopeLine(
        { kind: "document", document: DOC_A, section: "usage" },
        "basis",
        "책임 근거다",
      ),
    ],
    confirmed: ["ledger"],
    undecided: ["arrange"],
    boundaries: ["원본을 고치지 않는다"],
  });
  const saved = await run("document.create", {
    title: "컨텍스트 설계 보고",
    place: { kind: "project", id: PROJECT },
    name: "context-design-report",
    text: JSON.stringify(report),
    media_type: "text/markdown",
  });
  assertEquals(kind(saved), "success");
  // 저장 문서 ID는 소유 contract의 규약(documentIdFor)으로 정해진다.
  assert(saved.result.source !== null);
  assertEquals(saved.result.source!.version, VER_A);
  assert(/^doc_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(saved.result.source!.target));
  // 본문은 소유 contract(SaveToolDocument)로 그대로 넘어갔다.
  assertEquals(world.saved(), { text: JSON.stringify(report) });
});

// --- 용어 후보(R8) --------------------------------------------------------

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

Deno.test("lophn-agent/roles/context-engineer#R8: 세 문서 이상 본문에 그대로 나타난 미등록 말만 후보다", () => {
  assertEquals(CANDIDATE_DOCUMENT_MIN, 3);
  const result = candidateTerms({
    // 등록된 말은 다시 후보로 내지 않는다(R8).
    registered: ["snapshot"],
    // 본문이다. 이 본문에 그대로 나타나는 말만 근거가 된다(R8).
    bodies: new Map([
      [`${DOC_A}@${VER_A}`, "이 문서는 ledger를 다룬다"],
      [`${DOC_B}@${VER_B}`, "ledger는 여기서도 나온다"],
      [`${DOC_C}@${VER_C}`, "여기도 ledger가 그대로 나온다"],
      [`${DOC_B}@${VER_C}`, "arrange가 여기도 나온다"],
    ]),
    occurrences: new Map([
      ["ledger", [
        occurrence(DOC_A, VER_A),
        occurrence(DOC_B, VER_B),
        occurrence(DOC_C, VER_C),
      ]],
      // arrange는 두 문서뿐이라 후보가 아니다(R8).
      ["arrange", [
        occurrence(DOC_B, VER_B),
        occurrence(DOC_B, VER_C),
      ]],
      ["snapshot", [
        occurrence(DOC_A, VER_A),
        occurrence(DOC_B, VER_B),
        occurrence(DOC_C, VER_C),
      ]],
      // ghost는 세 문서 주소가 있어도 본문에 그대로 나타나지 않으므로 근거가 없다(R8).
      ["ghost", [
        occurrence(DOC_A, VER_A),
        occurrence(DOC_B, VER_B),
        occurrence(DOC_C, VER_C),
      ]],
    ]),
  });
  assertEquals(result.candidates.map((candidate) => candidate.name), [
    "ledger",
  ]);
  assertEquals(result.candidates[0]!.places, [
    occurrence(DOC_A, VER_A),
    occurrence(DOC_B, VER_B),
    occurrence(DOC_C, VER_C),
  ]);
  assertEquals(result.skipped.sort(), ["arrange", "ghost", "snapshot"]);
});

Deno.test("lophn-agent/roles/context-engineer#R8: 후보의 출현 주소는 최대 5개의 고정 참조다", () => {
  assertEquals(CANDIDATE_EVIDENCE_LIMIT, 5);
  const places = [
    occurrence(DOC_A, VER_A),
    occurrence(DOC_B, VER_B),
    occurrence(DOC_C, VER_C),
    occurrence(DOC_A, VER_A, "intro"),
    occurrence(DOC_B, VER_B, "intro"),
    occurrence(DOC_C, VER_C, "intro"),
  ];
  const { candidates } = candidateTerms({
    registered: [],
    bodies: new Map([
      [`${DOC_A}@${VER_A}`, "ledger 본문"],
      [`${DOC_B}@${VER_B}`, "ledger 본문"],
      [`${DOC_C}@${VER_C}`, "ledger 본문"],
    ]),
    occurrences: new Map([["ledger", places]]),
  });
  assertEquals(candidates.length, 1);
  assertEquals(candidates[0]!.places.length, CANDIDATE_EVIDENCE_LIMIT);
  const evidence = candidateEvidence(candidates[0]!.places);
  assertEquals(evidence.length, CANDIDATE_EVIDENCE_LIMIT);
  for (const reference of evidence) {
    assert(fixedVersionReferenceSchema.safeParse(reference).success);
  }
  // 후보는 definition을 가지지 않는다(R8). 정의 적용은 documents/terms의 몫이다.
  assertEquals(
    evidence.some((reference) => "definition" in reference),
    false,
  );
});

Deno.test("lophn-agent/roles/context-engineer#R8: 읽은 고정 판을 근거로 후보를 제안하면 소유 contract로 넘어간다", async () => {
  const world = readWorld();
  const { run } = rig(world);
  // 후보 근거의 고정 판을 이 run에서 실제로 읽는다. 읽기 기록이 근거를 정한다(R8).
  for (
    const [document, version] of [
      [DOC_A, VER_A],
      [DOC_B, VER_B],
      [DOC_C, VER_C],
    ] as const
  ) {
    const read = await run("document.read_section", {
      reference: { document, version, section: null },
      section: "usage",
    });
    assertEquals(kind(read), "success", document);
  }
  const propose = await run("term.propose_candidate", {
    context: id("ctx", 9),
    name: "ledger",
    evidence: [
      occurrence(DOC_A, VER_A),
      occurrence(DOC_B, VER_B),
      occurrence(DOC_C, VER_C),
    ],
  });
  assertEquals(kind(propose), "success");
  // 후보는 소유 contract로 이름·근거 3개를 넘겼고 definition은 없다(R8).
  assertEquals(world.proposed(), { name: "ledger", evidence: 3 });
});

Deno.test("lophn-agent/roles/context-engineer#R8: 읽지 않은 판을 근거로 든 후보 제안은 거절된다", async () => {
  const world = readWorld();
  const { run } = rig(world);
  const propose = await run("term.propose_candidate", {
    context: id("ctx", 9),
    name: "ledger",
    evidence: [
      occurrence(DOC_A, VER_A),
      occurrence(DOC_B, VER_B),
      occurrence(DOC_C, VER_C),
    ],
  });
  assertEquals(kind(propose), "failure");
  // 읽기 기록이 없으니 소유 contract까지 넘어가지 않는다(R8).
  assertEquals(world.proposed(), undefined);
});

// --- 대응 후보와 충돌(R9) --------------------------------------------------------

Deno.test("lophn-agent/roles/context-engineer#R9: 대응 후보와 충돌은 구별되고 충돌 판단은 lophn의 몫이다", () => {
  // 대응 후보는 같은 뜻의 다른 말, 충돌은 같은 말의 다른 뜻이다(R9).
  const corresponds = {
    name: "ledger",
    other: "log",
    relation: "corresponds" as const,
  };
  const conflicts = {
    name: "ledger",
    other: "cache",
    relation: "conflicts" as const,
  };
  assertEquals(
    [corresponds.relation, conflicts.relation],
    ["corresponds", "conflicts"],
  );
  const draft = conflictHandoff({
    name: conflicts.name,
    other: conflicts.other,
    context: id("ctx", 11),
    evidence: [occurrence(DOC_A, VER_A), occurrence(DOC_B, VER_B)],
    question: `"${conflicts.name}"과 "${conflicts.other}"의 뜻을 정해 주세요`,
  });
  // 충돌의 기획 판단은 lophn이다(R9).
  assertEquals(draft.to_role, "lophn");
  assertEquals(handoffAllowed("context_engineer", "lophn"), true);
  // handoff는 lophn-agent/handoff의 고정 근거 모양을 쓴다(R9).
  for (const reference of draft.references) {
    assert(handoffReferenceSchema.safeParse(reference).success);
    assertEquals(reference.question, null);
  }
  const content = handoffContentSchema.safeParse(draft.content);
  assert(content.success, JSON.stringify(content.error));
  assert(draft.content.what.includes(conflicts.name));
  // 사람의 뜻 없이 합치지 않는다(R9).
  assert(
    draft.content.excludes.some((exclusion) => exclusion.includes("병합")),
  );
});

Deno.test("lophn-agent/roles/context-engineer#R9: 해석 질문의 선택지는 고정 action 없이 세 갈래로 가른다", () => {
  const ask = interpretationQuestion({
    name: "ledger",
    other: "cache",
    question: "두 말의 뜻을 정해 주세요",
    evidence: [{ document: DOC_A, version: VER_A, section: "usage" }],
  });
  assertEquals(ask.options.length, 3);
  for (const option of ask.options) {
    const checked = questionOptionSchema.safeParse(option);
    assert(checked.success, JSON.stringify(checked.error));
    // 고정 action은 사람이 열람한 owner 동작을 정하는 별도 경로의 몫이다(T29).
    assertEquals(option.action, null);
  }
  // 근거는 고정 참조로 남는다(R10).
  assertEquals(ask.options[0]!.evidence, [{
    document: DOC_A,
    version: VER_A,
    section: "usage",
  }]);
  assertEquals(ask.options[2]!.evidence, []);
});

// --- 보류(R10) --------------------------------------------------------

Deno.test("lophn-agent/roles/context-engineer#R10: 답이 없으면 변경을 보류하고 정의로 적용하지 않는다", () => {
  const hold = holdWithoutAnswer("ledger", id("qst", 3), [
    "term.propose_candidate",
    "candidate merge",
  ]);
  assertEquals(hold, {
    name: "ledger",
    reason: "no_answer",
    question: id("qst", 3),
    held_changes: ["term.propose_candidate", "candidate merge"],
  });
});

Deno.test("lophn-agent/roles/context-engineer#R10: 필요한 결정은 질문으로 묶고 답이 없으면 그 질문 참조로 보류를 남긴다", async () => {
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
  // 답이 없으면 이 질문의 참조로 보류한다(R10).
  const hold = holdWithoutAnswer("ledger", id("qst", 9), [
    "term.propose_candidate",
  ]);
  assertEquals(hold.question, id("qst", 9));
  assertEquals(hold.reason, "no_answer");
});

// --- judgment·organizing 용도(R14) --------------------------------------------------------

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
    options: [{
      id: "effort",
      label: "Effort",
      values: [
        { value: "low", label: "Low", wire: null },
        { value: "medium", label: "Medium", wire: null },
        { value: "high", label: "High", wire: null },
      ],
      default_value: "medium",
      budget: null,
    }],
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

Deno.test("lophn-agent/roles/context-engineer#R14: 판단의 본문은 judgment, 정해진 보고 제목·요약은 organizing이다", () => {
  // 목적·경계·관점·term 해석의 본문은 judgment 용도다(R14).
  assertEquals(purposeOf("design_body"), "judgment");
  assertEquals(purposeOf("term_interpretation"), "judgment");
  // 이미 정한 보고 제목·요약은 organizing 용도다(R14).
  assertEquals(purposeOf("report_title"), "organizing");
  assertEquals(purposeOf("report_summary"), "organizing");
});

Deno.test("lophn-agent/roles/context-engineer#R14: 실제 model 선택은 preset의 두 용도로 검증된다", () => {
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
  // 두 용도는 서로 다른 선택으로 분리된다(R14).
  assertEquals(both.value.model!.option_values, { effort: "medium" });
  assertEquals(both.value.organizing_model!.option_values, { effort: "low" });
  // 그 model이 선언하지 않은 effort 값은 다른 값으로 바꾸지 않고 거절한다(harness/model#R24).
  const undeclared = validateDefinition({
    ...productPresetDefinition("context_engineer", HASH),
    model: { ...selection, reasoning_level: "maximum" as const },
    organizing_model: null,
  }, deps);
  assert(!undeclared.ok);
});

Deno.test("lophn-agent/roles/context-engineer#R14: 확인되지 않은 model은 저장을 거절하고 역할 상한은 model 호출 tool을 두지 않는다", () => {
  // 확인된 항목이 없으면 사용할 수 없다(R6, R14의 preset 경로).
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
  // 실제 model·계정은 preset 선택의 몫이다. 역할 상한은 model 호출 tool을 두지 않는다(R14).
  const cap = ROLE_CAPS.get("context_engineer")!;
  assertEquals(
    cap.tools.some((tool) =>
      tool.startsWith("model.") || tool.startsWith("provider.")
    ),
    false,
  );
  // 역할 상한도 model 이름을 고정하지 않는다(R14).
  assertEquals(
    cap.tools.some((tool) => tool.includes("claude") || tool.includes("gpt")),
    false,
  );
});

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
});
