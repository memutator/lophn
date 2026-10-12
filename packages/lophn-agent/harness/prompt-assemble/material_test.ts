import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import type { SkillEntry } from "../../extensions/mod.ts";
import { DATA_START_MARKER } from "../safety/mod.ts";
import {
  anthropicSystem,
  anthropicTools,
  assemblePrompt,
  type MaterialOmission,
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

const CTX_A = "ctx_01arz3ndektsv4rrffq69g5fav";
const CTX_B = "ctx_01arz3ndektsv4rrffq69g5faw";
const CTX_C = "ctx_01arz3ndektsv4rrffq69g5fax";
const HASH_1 = "h1";
const HASH_2 = "h2";
const AT = "2026-10-06T01:02:03Z";

function source(overrides: Partial<MaterialSource>): MaterialSource {
  return {
    address: CTX_A,
    title: "TITLE",
    version: HASH_1,
    overview: "OVERVIEW A",
    type_names: ["Alpha", "Beta"],
    glossary: "GLOSSARY A",
    has_glossary: true,
    ...overrides,
  };
}

function joined(rendered: RenderedMaterial): string {
  return rendered.materials.join("\n\n");
}

Deno.test("lophn-agent/harness/prompt-assemble#R4: context마다 자료 하나이고 머리에 이름·id·판 hash가 있으며 본문은 data 포장 안에 있다", async () => {
  const rendered = await renderMaterial(
    [
      source({ title: "Experiments", overview: "OVERVIEW A" }),
      source({ address: CTX_B, title: "Recipes", overview: "OVERVIEW B" }),
    ],
    { collected_at: AT },
  );
  assertEquals(rendered.materials.length, 2);
  const [first, second] = rendered.materials;
  assertStringIncludes(first, `[context] Experiments | ${CTX_A}`);
  assertStringIncludes(first, `version ${HASH_1}`);
  assertStringIncludes(first, DATA_START_MARKER);
  assertStringIncludes(first, "OVERVIEW A");
  assertStringIncludes(second, `[context] Recipes | ${CTX_B}`);
  assert(!/기준|참고|watch|변경됨/.test(joined(rendered)));
  assertEquals(
    rendered.references.map((r) => [r.address, r.version, r.depth]),
    [[CTX_A, HASH_1, "full"], [CTX_B, HASH_1, "full"]],
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R5: 같은 context·판은 한 번만 넣고 판이 다르면 합치지 않으며 같은 입력은 같은 byte다", async () => {
  const input = [
    source({}),
    source({ overview: "DUPLICATE" }),
    source({ version: HASH_2, overview: "OTHER VERSION" }),
  ];
  const rendered = await renderMaterial(input, { collected_at: AT });
  assertEquals(rendered.references.length, 2);
  const text = joined(rendered);
  assert(!text.includes("DUPLICATE"));
  assertStringIncludes(text, "OTHER VERSION");
  const again = await renderMaterial(input, { collected_at: AT });
  assertEquals(again.materials, rendered.materials);
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
    registered: () => Promise.resolve(ok(null)),
    attached: () =>
      Promise.resolve(err({ code: "not_found", message: "none" })),
    projectOf: () => Promise.resolve(ok(null)),
  },
  redact: (text) => text,
  pack: packer,
};

function promptWith(materials: string[], contextLimit: number): PromptInput {
  return {
    product: { instructions: "PRODUCT" },
    tools: [],
    role: { instructions: "ROLE", preset_prompt: null },
    work: {
      role: "lophn",
      session: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" },
      scope: { kind: "all", id: null },
    },
    attachments: [],
    material: {
      purpose: null,
      run_facts: null,
      continuation_summary: null,
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
// 용어집이 큰 context 셋. 이름 CTX-n, type 이름 TYPE-n.
function shrinkSource(address: string, label: string): MaterialSource {
  return source({
    address,
    overview: big(`OV-${label}`),
    type_names: [`TYPE-${label}`],
    glossary: big(`GL-${label}`),
  });
}
const SHRINK_SOURCES: MaterialSource[] = [
  shrinkSource(CTX_A, "ONE"),
  shrinkSource(CTX_B, "TWO"),
  shrinkSource(CTX_C, "THREE"),
];

Deno.test("lophn-agent/harness/prompt-assemble#R18: 초기 자료 초과는 용어집을 뒤 context부터 먼저 줄이고 그다음 overview를 뒤 context부터 type 이름만 남기며 생략 수를 밝힌다", async () => {
  const stages: RenderedMaterial[] = [];
  await shrinkMaterial(SHRINK_SOURCES, { collected_at: AT }, (rendered) => {
    stages.push(rendered);
    return Promise.resolve(false);
  });
  assertEquals(stages.length, 7);
  assertEquals(
    stages.map((s) => s.omissions.map((o) => `${o.level}:${o.source}`)),
    [
      [],
      [`glossary:${CTX_C}`],
      [`glossary:${CTX_C}`, `glossary:${CTX_B}`],
      [`glossary:${CTX_C}`, `glossary:${CTX_B}`, `glossary:${CTX_A}`],
      [
        `glossary:${CTX_C}`,
        `glossary:${CTX_B}`,
        `glossary:${CTX_A}`,
        `overview:${CTX_C}`,
      ],
      [
        `glossary:${CTX_C}`,
        `glossary:${CTX_B}`,
        `glossary:${CTX_A}`,
        `overview:${CTX_C}`,
        `overview:${CTX_B}`,
      ],
      [
        `glossary:${CTX_C}`,
        `glossary:${CTX_B}`,
        `glossary:${CTX_A}`,
        `overview:${CTX_C}`,
        `overview:${CTX_B}`,
        `overview:${CTX_A}`,
      ],
    ],
  );
  // 용어집을 다 줄인 단계에서도 overview는 모두 남아 있다.
  const glossaryDone = joined(stages[3]);
  assert(!glossaryDone.includes("GL-"));
  assertStringIncludes(glossaryDone, "OV-THREE");
  // 마지막 단계는 context 이름·id와 type 이름만 남는다.
  const last = stages[6];
  const lastText = joined(last);
  assert(!lastText.includes("OV-") && !lastText.includes("GL-"));
  assertStringIncludes(lastText, "TYPE-ONE");
  assertStringIncludes(lastText, `| ${CTX_C} |`);
  assertEquals(
    last.references.map((r) => r.depth),
    ["names_only", "names_only", "names_only"],
  );

  // 용어집 하나를 줄인 크기에 맞춰 assemblePrompt의 input_over_budget에 반응해 다시 조립한다.
  const stageBytes = encoder.encode(stages[1].materials.join("")).byteLength;
  const probe = await assemblePrompt(deps, promptWith([], 1_000_000));
  assert(probe.status === "ready");
  const limit = probe.assembly.measured_tokens + stageBytes + 100;
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
  assert(!text.includes("GL-THREE"));
  assertStringIncludes(text, "OV-THREE");
  assertStringIncludes(text, "GL-ONE");
  assertStringIncludes(text, "[자료 생략]");
});

Deno.test("lophn-agent/harness/prompt-assemble#R18: 용어집이 없는 context는 용어집 단계에서 건너뛰고 생략으로 세지 않는다", async () => {
  const sources = [
    shrinkSource(CTX_A, "ONE"),
    { ...shrinkSource(CTX_B, "TWO"), has_glossary: false },
  ];
  const stages: RenderedMaterial[] = [];
  await shrinkMaterial(sources, { collected_at: AT }, (rendered) => {
    stages.push(rendered);
    return Promise.resolve(false);
  });
  assertEquals(
    stages.map((s) => s.omissions.map((o) => `${o.level}:${o.source}`)),
    [
      [],
      [`glossary:${CTX_A}`],
      [`glossary:${CTX_A}`, `overview:${CTX_B}`],
      [`glossary:${CTX_A}`, `overview:${CTX_B}`, `overview:${CTX_A}`],
    ],
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R18: 자료를 모두 type 이름만으로 줄여도 필수 입력이 넘으면 fits가 거짓이라 호출하지 않는다", async () => {
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
  assertEquals(result.omissions.length, 6);
  assertEquals(
    result.references.every((r) => r.depth === "names_only"),
    true,
  );
  // 필수 입력만으로 초과하는 창에서는 조립이 호출 자체를 막는다.
  const blocked = await assemblePrompt(deps, promptWith([], 150));
  assert(blocked.status === "blocked");
  assertEquals(blocked.reason, "mandatory_input_overflow");
});

Deno.test("lophn-agent/harness/prompt-assemble#R18 [ctx-T10d]: 읽지 못한 context는 자리표시 자료와 함께 load_failed 생략으로 남고 줄이기에서도 이유가 남는다", async () => {
  const failed = source({
    address: CTX_B,
    title: "Gone",
    version: null,
    overview:
      "[자료 없음] 계약을 읽지 못했다(not_found). 필요하면 tool로 다시 읽는다.",
    type_names: [],
    glossary: "",
    has_glossary: false,
    unavailable: "계약을 읽지 못했다(not_found)",
  });
  const expected: MaterialOmission[] = [{
    source: CTX_B,
    level: "material",
    reason: "load_failed",
    detail: "계약을 읽지 못했다(not_found)",
  }];
  const initial = await renderMaterial([source({}), failed], {
    collected_at: AT,
  });
  assertEquals(initial.omissions, expected);
  // 예산 안내 줄은 줄인 것이 없으면 붙지 않는다.
  assert(!joined(initial).includes("[자료 생략]"));
  assertStringIncludes(joined(initial), "[자료 없음]");

  const shrunk = await shrinkMaterial(
    [source({}), failed],
    { collected_at: AT },
    () => Promise.resolve(false),
  );
  assertEquals(shrunk.omissions[0], expected[0]);
  // 읽지 못한 context의 이유는 overview를 줄여도 사라지지 않는다.
  assertEquals(
    shrunk.omissions.filter((o) => o.source === CTX_B).length,
    1,
  );
  assertStringIncludes(joined(shrunk), "[자료 없음]");
  assertEquals(
    shrunk.references.find((r) => r.address === CTX_B)?.depth,
    "full",
  );
});
