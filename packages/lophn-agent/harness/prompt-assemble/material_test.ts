import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import type { SkillEntry } from "../../extensions/mod.ts";
import { DATA_START_MARKER } from "../safety/mod.ts";
import {
  anthropicSystem,
  anthropicTools,
  assemblePrompt,
  historySectionKey,
  type MaterialSource,
  type PromptDeps,
  type PromptInput,
  type RenderedMaterial,
  renderMaterial,
  shrinkMaterial,
  skillHistoryResult,
  skillInstructionText,
  type WirePacker,
} from "./mod.ts";

const DOC_A = "doc_01arz3ndektsv4rrffq69g5fav";
const DOC_B = "doc_01arz3ndektsv4rrffq69g5faw";
const DOC_C = "doc_01arz3ndektsv4rrffq69g5fax";
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const VER_1 = "ver_01arz3ndektsv4rrffq69g5fav";
const VER_2 = "ver_01arz3ndektsv4rrffq69g5faw";
const AT = "2026-10-06T01:02:03Z";

function source(overrides: Partial<MaterialSource>): MaterialSource {
  return {
    target: { kind: "document", document: DOC_A, section: null },
    perspective: "basis",
    title: "TITLE",
    version: VER_1,
    summary: null,
    outline: [],
    changed: false,
    change_seq: null,
    sections: [],
    ...overrides,
  };
}

const BASIS = source({
  summary: "BASIS SUMMARY",
  outline: [
    { key: "intro", title: "Intro", parent: null },
    { key: "intro.detail", title: "Detail", parent: "intro" },
  ],
  sections: [{ key: "intro", text: "INTRO BODY" }],
});
const REFERENCE = source({
  target: { kind: "document", document: DOC_B, section: null },
  perspective: "reference",
  title: "REF TITLE",
  summary: "REF SUMMARY",
  outline: [{ key: "ref-top", title: "Ref Top", parent: null }],
  sections: [{ key: "ref-top", text: "REF BODY" }],
});
const WATCH_CHANGED = source({
  target: { kind: "document", document: DOC_C, section: null },
  perspective: "watch",
  title: "WATCH TITLE",
  summary: "WATCH SUMMARY",
  changed: true,
  change_seq: 7,
});
const WATCH_SAME = source({
  target: { kind: "app_command", app: APP, command: "list" },
  perspective: "watch",
  title: "SAME TITLE",
  summary: "SAME SUMMARY",
  changed: false,
});

function joined(rendered: RenderedMaterial): string {
  return rendered.materials.join("\n\n");
}

Deno.test("lophn-agent/harness/prompt-assemble#R4: 기준은 주소·version·summary·최상위 outline, 참고는 주소·summary, watch는 변경 자료만 summary와 변경 표시이고 미변경은 주소만 넣는다", async () => {
  const rendered = await renderMaterial(
    [
      { ...BASIS, sections: [] },
      { ...REFERENCE, sections: [] },
      WATCH_CHANGED,
      WATCH_SAME,
    ],
    { collected_at: AT },
  );
  const [basis, reference, changed, same] = rendered.materials;
  assertStringIncludes(basis, `document ${DOC_A}`);
  assertStringIncludes(basis, `version ${VER_1}`);
  assertStringIncludes(basis, "BASIS SUMMARY");
  assertStringIncludes(basis, "- intro Intro");
  assert(!basis.includes("Detail"), "하위 section은 outline에 없다");
  assertStringIncludes(reference, "REF SUMMARY");
  assert(!reference.includes("Ref Top"), "참고는 outline이 없다");
  assertStringIncludes(changed, "변경됨");
  assertStringIncludes(changed, "WATCH SUMMARY");
  assertStringIncludes(same, `app_command ${APP} list`);
  assertStringIncludes(same, "미변경");
  assert(!same.includes("SAME SUMMARY") && !same.includes("SAME TITLE"));
  // 자료에서 온 글은 모두 포장 안에 있다.
  assertStringIncludes(basis, DATA_START_MARKER);
  assertEquals(
    rendered.references.map((r) => [r.perspective, r.depth]),
    [
      ["basis", "full"],
      ["reference", "full"],
      ["watch", "full"],
      ["watch", "address_only"],
    ],
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R4: 본문은 요청한 section만 펼친다", async () => {
  const none = await renderMaterial([{ ...BASIS, sections: [] }], {
    collected_at: AT,
  });
  assert(!joined(none).includes("INTRO BODY"));
  const asked = await renderMaterial([BASIS], { collected_at: AT });
  assertStringIncludes(joined(asked), "INTRO BODY");
  assertEquals(asked.references[0].sections, ["intro"]);
});

Deno.test("lophn-agent/harness/prompt-assemble#R5: 같은 대상·version·관점은 한 번만, 다르면 제목이 같아도 합치지 않고 tool 이력에 있는 본문은 다시 붙이지 않는다", async () => {
  const rendered = await renderMaterial(
    [
      BASIS,
      { ...BASIS, summary: "DUPLICATE" },
      { ...BASIS, version: VER_2, summary: "OTHER VERSION" },
      { ...BASIS, perspective: "reference", summary: "OTHER PERSPECTIVE" },
    ],
    { collected_at: AT },
  );
  assertEquals(rendered.references.length, 3);
  const text = joined(rendered);
  assert(!text.includes("DUPLICATE"));
  assertStringIncludes(text, "OTHER VERSION");
  assertStringIncludes(text, "OTHER PERSPECTIVE");

  const inHistory = await renderMaterial([BASIS], {
    collected_at: AT,
    in_history: new Set([historySectionKey(DOC_A, VER_1, "intro")]),
  });
  assert(!joined(inHistory).includes("INTRO BODY"));
  assertEquals(inHistory.references[0].sections, []);
});

function skill(name: string, selected: boolean): SkillEntry {
  return {
    name,
    description: `${name} 설명`,
    selected,
    // 본문과 로컬 경로가 있어도 지시에는 나가지 않는다.
    body: `${name} 본문 SECRET_BODY`,
    path: `/local/${name}`,
  } as unknown as SkillEntry;
}

Deno.test("lophn-agent/harness/prompt-assemble#R6: skill은 선택한 이름·설명만 지시에 넣고 본문은 tool 이력 조각에만 들어가며 다시 읽는 안내가 있다", async () => {
  const text = skillInstructionText([
    skill("zeta", true),
    skill("alpha", true),
    skill("hidden", false),
  ]);
  assert(text !== null);
  assert(text.indexOf("alpha") < text.indexOf("zeta"));
  assertStringIncludes(text, "alpha 설명");
  assert(!text.includes("hidden"));
  assert(!text.includes("SECRET_BODY") && !text.includes("/local/"));
  assertStringIncludes(text, "다시 읽는다");
  assertEquals(skillInstructionText([skill("hidden", false)]), null);

  const part = await skillHistoryResult("tu_9", "alpha", "BODY TEXT", AT);
  assert(part.kind === "tool_result");
  assertStringIncludes(part.text, DATA_START_MARKER);
  assertStringIncludes(part.text, "BODY TEXT");
});

// ---- R18: 초기 자료 초과 축소 ----

const encoder = new TextEncoder();
const packer: WirePacker = (request) => ({
  body: {
    tools: anthropicTools(request),
    system: anthropicSystem(request),
    messages: request.messages,
  },
  opaque_bytes: 0,
});
const deps: PromptDeps = {
  files: {
    read: () => Promise.resolve(ok(null)),
  },
  redact: (text) => text,
  pack: packer,
};

function promptWith(materials: string[], contextLimit: number): PromptInput {
  return {
    product: { instructions: "PRODUCT" },
    tools: [],
    role: { instructions: "ROLE" },
    work: {
      role: "lophn",
      session: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" },
      scope: { kind: "all", id: null },
    },
    material: {
      purpose: null,
      run_facts: null,
      compact_summary: null,
      materials,
      compaction_summary: null,
      history: [],
      request: "CURRENT REQUEST FULL TEXT",
      steering: [],
    },
    turn_context: null,
    limits: {
      context_limit: contextLimit,
      input_limit: contextLimit,
      output_limit: 100,
    },
    reserved_output: 100,
  };
}

const big = (label: string) => `${label} ${"x".repeat(600)}`;
const SHRINK_SOURCES: MaterialSource[] = [
  source({
    perspective: "reference",
    target: { kind: "document", document: DOC_B, section: null },
    summary: big("REF-ONE"),
  }),
  source({
    perspective: "reference",
    target: { kind: "document", document: DOC_C, section: null },
    summary: big("REF-TWO"),
  }),
  source({
    summary: big("BASIS-SUMMARY"),
    outline: [{ key: "top", title: big("BASIS-OUTLINE"), parent: null }],
  }),
  source({
    perspective: "watch",
    target: { kind: "document", document: DOC_C, section: "late" },
    summary: big("WATCH-NEW"),
    changed: true,
    change_seq: 9,
  }),
  source({
    perspective: "watch",
    target: { kind: "document", document: DOC_C, section: "early" },
    summary: big("WATCH-OLD"),
    changed: true,
    change_seq: 2,
  }),
];

Deno.test("lophn-agent/harness/prompt-assemble#R18: 초기 자료 초과는 참고 summary → 기준 outline → 선택 자료(오래된 변경부터) 순으로 주소만 남기고 생략 수를 밝힌다", async () => {
  // 단계마다 조립한 입력을 모은다.
  const stages: RenderedMaterial[] = [];
  await shrinkMaterial(SHRINK_SOURCES, { collected_at: AT }, (rendered) => {
    stages.push(rendered);
    return Promise.resolve(false);
  });
  const levels = stages.map((s) => s.omissions.map((o) => o.level));
  assertEquals(levels[0], []);
  assertEquals(levels[1], ["reference_summary"]);
  assertEquals(levels[2], ["reference_summary", "reference_summary"]);
  assertEquals(levels[3].at(-1), "basis_outline");
  assertEquals(
    stages[4].omissions.at(-1)?.source,
    `document ${DOC_C}#early`,
    "오래된 변경부터",
  );
  assertEquals(stages[5].omissions.at(-1)?.source, `document ${DOC_C}#late`);

  // 기준 outline까지 줄인 크기에 맞춰 assemblePrompt의 input_over_budget에 반응해 다시 조립한다.
  const stageBytes = encoder.encode(stages[3].materials.join("")).byteLength;
  const probe = await assemblePrompt(deps, promptWith([], 1_000_000));
  assert(probe.status === "ready");
  const limit = probe.assembly.measured_tokens + stageBytes + 700;
  let blockedCount = 0;
  const result = await shrinkMaterial(
    SHRINK_SOURCES,
    { collected_at: AT },
    async (rendered) => {
      const assembled = await assemblePrompt(
        deps,
        promptWith(rendered.materials, limit),
      );
      if (assembled.status === "blocked") {
        assertEquals(assembled.reason, "input_over_budget");
        blockedCount++;
      }
      return assembled.status === "ready";
    },
  );
  assert(result.fits);
  assert(blockedCount >= 1);
  const text = joined(result);
  assert(!text.includes("REF-ONE") && !text.includes("REF-TWO"));
  assertStringIncludes(text, "WATCH-OLD");
  assert(result.omissions.every((o) => o.level !== "selected_material"));
  // 생략 범위와 수가 자료에 보인다.
  assertStringIncludes(text, "[자료 생략]");
  assertStringIncludes(text, "참고 summary 2개");
  assertStringIncludes(text, `document ${DOC_B}`);
});

Deno.test("lophn-agent/harness/prompt-assemble#R18: 자료를 모두 주소만으로 줄여도 필수 입력이 넘으면 fits가 거짓이라 호출하지 않는다", async () => {
  const probe = await assemblePrompt(deps, promptWith([], 1_000_000));
  assert(probe.status === "ready");
  // 필수 입력(지시·현재 요청)만 겨우 들어가는 창이다.
  const limit = probe.assembly.measured_tokens + 100;
  const result = await shrinkMaterial(
    SHRINK_SOURCES,
    { collected_at: AT },
    async (rendered) => {
      const assembled = await assemblePrompt(
        deps,
        promptWith(rendered.materials, limit),
      );
      return assembled.status === "ready";
    },
  );
  assertEquals(result.fits, false);
  assertEquals(
    result.omissions.filter((o) => o.level === "selected_material").length,
    3,
  );
  assertEquals(
    result.references.every((r) => r.depth === "address_only"),
    true,
  );
  // 필수 입력만으로 초과하는 창에서는 조립이 호출 자체를 막는다.
  const blocked = await assemblePrompt(deps, promptWith([], 150));
  assert(blocked.status === "blocked");
  assertEquals(blocked.reason, "mandatory_input_overflow");
});
