import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import type { SkillEntry } from "../../extensions/mod.ts";
import { DATA_START_MARKER } from "../safety/mod.ts";
import {
  anthropicSystem,
  anthropicTools,
  assemblePrompt,
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
    text: "OVERVIEW A",
    ...overrides,
  };
}

function joined(rendered: RenderedMaterial): string {
  return rendered.materials.join("\n\n");
}

Deno.test("lophn-agent/harness/prompt-assemble#R4: context마다 자료 하나이고 머리에 이름·id·판 hash가 있으며 본문은 data 포장 안에 있다", async () => {
  const rendered = await renderMaterial(
    [
      source({ title: "Experiments", text: "OVERVIEW A" }),
      source({ address: CTX_B, title: "Recipes", text: "OVERVIEW B" }),
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
    source({ text: "DUPLICATE" }),
    source({ version: HASH_2, text: "OTHER VERSION" }),
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
const SHRINK_SOURCES: MaterialSource[] = [
  source({ address: CTX_A, text: big("CTX-ONE") }),
  source({ address: CTX_B, text: big("CTX-TWO") }),
  source({ address: CTX_C, text: big("CTX-THREE") }),
];

Deno.test("lophn-agent/harness/prompt-assemble#R18: 초기 자료 초과는 뒤 context부터 주소만 남기고 생략 수를 밝힌다", async () => {
  const stages: RenderedMaterial[] = [];
  await shrinkMaterial(SHRINK_SOURCES, { collected_at: AT }, (rendered) => {
    stages.push(rendered);
    return Promise.resolve(false);
  });
  assertEquals(stages.length, 4);
  assertEquals(stages[0].omissions, []);
  assertEquals(stages.map((s) => s.omissions.map((o) => o.source)), [
    [],
    [CTX_C],
    [CTX_C, CTX_B],
    [CTX_C, CTX_B, CTX_A],
  ]);

  // 한 context를 줄인 크기에 맞춰 assemblePrompt의 input_over_budget에 반응해 다시 조립한다.
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
  assert(!text.includes("CTX-THREE"));
  assertStringIncludes(text, "CTX-ONE");
  assertStringIncludes(text, "[자료 생략]");
  assertStringIncludes(text, CTX_C);
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
  assertEquals(result.omissions.length, 3);
  assertEquals(
    result.references.every((r) => r.depth === "address_only"),
    true,
  );
  // 필수 입력만으로 초과하는 창에서는 조립이 호출 자체를 막는다.
  const blocked = await assemblePrompt(deps, promptWith([], 150));
  assert(blocked.status === "blocked");
  assertEquals(blocked.reason, "mandatory_input_overflow");
});
