import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import {
  INSTRUCTION_FILE_MAX_BYTES,
  type InstructionFile,
  type InstructionFiles,
} from "../../instructions/mod.ts";
import {
  anthropicSystem,
  anthropicTools,
  assemblePrompt,
  type AssembleResult,
  inputBudget,
  type PromptAssembly,
  type PromptDeps,
  type PromptInput,
  type PromptTool,
  type WirePacker,
} from "./mod.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const APP = "app_01arz3ndektsv4rrffq69g5fav";

const encoder = new TextEncoder();

// 지침 읽기 통로 가짜. 부른 횟수를 센다.
function instructionSource(seed: {
  global?: string;
  project?: string;
  agent?: string;
  failing?: boolean;
}) {
  const texts = {
    global: seed.global,
    project: seed.project,
    agent: seed.agent,
  };
  const state = { reads: 0, edits: 0 };
  function fileOf(text: string): InstructionFile {
    const bytes = encoder.encode(text);
    return {
      size_bytes: bytes.length,
      bytes: bytes.slice(0, INSTRUCTION_FILE_MAX_BYTES),
    };
  }
  const files: InstructionFiles = {
    read(layer) {
      state.reads++;
      if (seed.failing) {
        return Promise.resolve(
          err({ code: "unavailable", message: "/private/LOPHN.md" }),
        );
      }
      const text = layer === "global"
        ? texts.global
        : layer === "project"
        ? texts.project
        : layer === "agent"
        ? texts.agent
        : undefined;
      return Promise.resolve(ok(text === undefined ? null : fileOf(text)));
    },
  };
  return {
    files,
    state,
    edit(layer: "global" | "project" | "agent", text: string) {
      texts[layer] = text;
      state.edits++;
    },
  };
}

// provider 포장 가짜. 요청을 감싸는 필드와 adapter가 따로 쥔 opaque 상태를 더한다.
function packer(opaque = 0): WirePacker {
  return (request) => ({
    body: {
      model: "fake-model",
      max_tokens: 4096,
      stream: true,
      tools: anthropicTools(request),
      system: anthropicSystem(request),
      messages: request.messages,
    },
    opaque_bytes: opaque,
  });
}

const TOOLS: PromptTool[] = [
  {
    name: "document.read",
    description: "문서를 읽는다",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, section: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "app.list",
    description: "앱 목록",
    input_schema: { type: "object", properties: {} },
  },
];

function inputOf(overrides: Partial<PromptInput> = {}): PromptInput {
  return {
    product: { instructions: "PRODUCT RULES" },
    tools: TOOLS,
    role: { instructions: "ROLE RULES" },
    work: {
      role: "lophn",
      session: { kind: "project", id: PROJECT },
      scope: { kind: "all", id: null },
    },
    material: {
      purpose: "PURPOSE",
      run_facts: "RUN FACTS",
      compact_summary: "COMPACT SUMMARY",
      materials: ["MATERIAL A", "MATERIAL B"],
      compaction_summary: "COMPACTION",
      history: [
        { role: "user", parts: [{ kind: "text", text: "HISTORY USER" }] },
        {
          role: "assistant",
          parts: [
            { kind: "text", text: "HISTORY ASSISTANT" },
            {
              kind: "tool_use",
              id: "tu_1",
              name: "app.list",
              input: { b: 1, a: 2 },
            },
          ],
        },
        {
          role: "user",
          parts: [{ kind: "tool_result", id: "tu_1", text: "RESULT" }],
        },
      ],
      request: "CURRENT REQUEST",
      steering: ["STEER 1", "STEER 2", "STEER 3"],
    },
    turn_context: "TURN CONTEXT tab=A",
    limits: { context_limit: 200000, input_limit: 150000, output_limit: 32000 },
    reserved_output: 8000,
    ...overrides,
  };
}

function depsOf(
  source: ReturnType<typeof instructionSource>,
  pack: WirePacker = packer(),
): PromptDeps {
  return { files: source.files, redact: (text) => text, pack };
}

function ready(result: AssembleResult): PromptAssembly {
  assert(result.status === "ready", JSON.stringify(result));
  return result.assembly;
}

function bytesOf(value: unknown): string {
  return JSON.stringify(value);
}

Deno.test("lophn-agent/harness/prompt-assemble#R2: 제품·역할(role_agent)·사람 지침 층이 순서대로 놓이고 이력·자료는 그 뒤, 동적 context는 맨 끝이다", async () => {
  const source = instructionSource({
    global: "GLOBAL RULE",
    project: "PROJECT RULE",
  });
  const assembly = ready(await assemblePrompt(depsOf(source), inputOf()));
  assertEquals(assembly.layers.map((layer) => layer.kind), [
    "product",
    "role_agent",
    "user_instructions",
    "work_material",
    "turn_context",
  ]);
  const system = assembly.request.system;
  assertEquals(system.map((block) => block.layer), [
    "product",
    "role_agent",
    "user_instructions",
  ]);
  assertEquals(system[0].text, "PRODUCT RULES");
  assertEquals(system[1].text, "ROLE RULES");
  // 전역 → project 순
  assert(
    system[2].text.indexOf("GLOBAL RULE") <
      system[2].text.indexOf("PROJECT RULE"),
  );
  const last = assembly.request.messages.at(-1)!;
  assertEquals(last.parts.at(-1), { kind: "text", text: "TURN CONTEXT tab=A" });
  // 이력과 자료는 system 층에 섞이지 않는다.
  assert(!bytesOf(system).includes("HISTORY USER"));
  assert(!bytesOf(system).includes("MATERIAL A"));
});

Deno.test("lophn-agent/harness/prompt-assemble#R2 [agent-I10b]: agent 정의 본문은 사람 지침 층의 맨 끝에 있고 역할 층(role_agent)에는 제품 역할 지시만 있다", async () => {
  const source = instructionSource({
    global: "GLOBAL RULE",
    project: "PROJECT RULE",
    agent: "AGENT BODY",
  });
  const input = inputOf({
    // 옛 role.preset_prompt 칸을 실어도 역할 층에 들어가지 않는다.
    role: { instructions: "ROLE RULES", preset_prompt: "OLD PRESET" } as never,
  });
  const assembly = ready(await assemblePrompt(depsOf(source), input));
  const system = assembly.request.system;
  assertEquals(system[1].layer, "role_agent");
  assertEquals(system[1].text, "ROLE RULES");
  assert(!bytesOf(assembly.request).includes("OLD PRESET"));
  const human = system[2].text;
  assertEquals(system[2].layer, "user_instructions");
  assert(human.indexOf("GLOBAL RULE") < human.indexOf("PROJECT RULE"));
  assert(human.indexOf("PROJECT RULE") < human.indexOf("AGENT BODY"));
  assertEquals(
    assembly.basis.instructions.layers.map((layer) => layer.kind),
    ["global", "project", "agent"],
  );
  // agent 본문이 바뀌어도 제품·역할 층 hash는 그대로이고 사람 지침 층만 바뀐다.
  source.edit("agent", "AGENT BODY 2");
  const edited = ready(await assemblePrompt(depsOf(source), input));
  const hash = (made: PromptAssembly, kind: string) =>
    made.layers.find((layer) => layer.kind === kind)!.hash;
  assertEquals(hash(edited, "role_agent"), hash(assembly, "role_agent"));
  assertNotEquals(
    hash(edited, "user_instructions"),
    hash(assembly, "user_instructions"),
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R2: 필수 제품·역할·지침이 없으면 조립하지 않고 호출하지 않는다", async () => {
  const source = instructionSource({ global: "GLOBAL RULE" });
  const noProduct = await assemblePrompt(
    depsOf(source),
    inputOf({ product: null }),
  );
  assertEquals(
    noProduct.status === "blocked" && noProduct.reason,
    "product_missing",
  );
  const blankRole = await assemblePrompt(
    depsOf(source),
    inputOf({ role: { instructions: "  " } }),
  );
  assertEquals(
    blankRole.status === "blocked" && blankRole.reason,
    "role_missing",
  );
  // 지침 읽기 실패는 부재가 아니라 막힘이다.
  const failing = instructionSource({ failing: true });
  const unreadable = await assemblePrompt(depsOf(failing), inputOf());
  assertEquals(
    unreadable.status === "blocked" && unreadable.reason,
    "instructions_blocked",
  );
  assert(!JSON.stringify(unreadable).includes("/private"));
  // 파일 상한을 넘으면 자르지 않고 막는다.
  const huge = instructionSource({
    global: "x".repeat(INSTRUCTION_FILE_MAX_BYTES + 1),
  });
  const tooLarge = await assemblePrompt(depsOf(huge), inputOf());
  assertEquals(
    tooLarge.status === "blocked" && tooLarge.reason,
    "instructions_blocked",
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R3 [agent-I16b]: 작업 재료는 목적·run 사실 → Compact summary → 자료 → 압축 summary → 이력 → 현재 요청·steering 순이고 요청·steering은 빠짐없다", async () => {
  const source = instructionSource({});
  const assembly = ready(await assemblePrompt(depsOf(source), inputOf()));
  const text = assembly.request.messages.map((message) =>
    message.parts.map((part) =>
      part.kind === "text" || part.kind === "tool_result"
        ? part.text
        : part.name
    ).join("\n")
  ).join("\n");
  // Compact가 만든 요약은 사람의 말이나 agent의 답이 아니라 요약이라고 머리에 밝힌다.
  assert(text.includes("## Compact summary\nCOMPACT SUMMARY"));
  const order = [
    "PURPOSE",
    "RUN FACTS",
    "COMPACT SUMMARY",
    "MATERIAL A",
    "MATERIAL B",
    "COMPACTION",
    "HISTORY USER",
    "HISTORY ASSISTANT",
    "RESULT",
    "CURRENT REQUEST",
    "STEER 1",
    "STEER 2",
    "STEER 3",
  ].map((needle) => text.indexOf(needle));
  assert(order.every((index) => index >= 0));
  assertEquals(order, [...order].sort((a, b) => a - b));
  // tool 짝 순서와 id가 그대로다.
  const flat = assembly.request.messages.flatMap((message) => message.parts);
  const use = flat.findIndex((part) => part.kind === "tool_use");
  assertEquals(flat[use + 1], {
    kind: "tool_result",
    id: "tu_1",
    text: "RESULT",
  });

  // 없는 부분은 가짜 내용 없이 생략한다.
  const bare = ready(
    await assemblePrompt(
      depsOf(source),
      inputOf({
        turn_context: null,
        material: {
          purpose: null,
          run_facts: null,
          compact_summary: null,
          materials: [],
          compaction_summary: null,
          history: [],
          request: "ONLY REQUEST",
          steering: [],
        },
      }),
    ),
  );
  assertEquals(bare.request.messages, [
    { role: "user", parts: [{ kind: "text", text: "ONLY REQUEST" }] },
  ]);
  assertEquals(bare.layers.map((layer) => layer.kind), [
    "product",
    "role_agent",
    "user_instructions",
    "work_material",
  ]);
});

Deno.test("lophn-agent/harness/prompt-assemble#R1: 같은 재료·지침·자리면 byte가 같고 tool·schema key 순서에 기대지 않으며 지침 편집은 다음 call부터 새 hash다", async () => {
  const source = instructionSource({ global: "RULE ONE" });
  const first = ready(await assemblePrompt(depsOf(source), inputOf()));
  const again = ready(await assemblePrompt(depsOf(source), inputOf()));
  assertEquals(bytesOf(again.request), bytesOf(first.request));
  assertEquals(again.input_hash, first.input_hash);
  assertEquals(again.basis_hash, first.basis_hash);
  // 매 call 지침을 다시 읽는다.
  assertEquals(source.state.reads, 6);

  // tool 목록·schema key 순서가 달라도 같은 prompt다.
  const shuffled = ready(
    await assemblePrompt(
      depsOf(source),
      inputOf({
        tools: [
          {
            name: "app.list",
            description: "앱 목록",
            input_schema: { properties: {}, type: "object" },
          },
          {
            name: "document.read",
            description: "문서를 읽는다",
            input_schema: {
              required: ["id"],
              properties: {
                section: { type: "string" },
                id: { type: "string" },
              },
              type: "object",
            },
          },
        ],
      }),
    ),
  );
  assertEquals(shuffled.input_hash, first.input_hash);

  // 편집은 다음 call에서 새 version·hash로 들어가고 제품·역할 층은 그대로다.
  source.edit("global", "RULE TWO");
  const edited = ready(await assemblePrompt(depsOf(source), inputOf()));
  assertNotEquals(edited.input_hash, first.input_hash);
  const hash = (assembly: PromptAssembly, kind: string) =>
    assembly.layers.find((layer) => layer.kind === kind)!.hash;
  assertEquals(hash(edited, "product"), hash(first, "product"));
  assertEquals(hash(edited, "role_agent"), hash(first, "role_agent"));
  assertNotEquals(
    hash(edited, "user_instructions"),
    hash(first, "user_instructions"),
  );
  assertNotEquals(
    edited.basis.instructions.layers[0].source_hash,
    first.basis.instructions.layers[0].source_hash,
  );
  assert(edited.request.system[2].text.includes("RULE TWO"));
});

Deno.test("lophn-agent/harness/prompt-assemble#R30: 지침은 작업 자리로 resolve하고 본문 없는 근거만 basis에 남기며 탭 context는 층 선택을 바꾸지 않는다", async () => {
  const source = instructionSource({
    global: "GLOBAL SECRET RULE",
    project: "PROJECT RULE",
  });
  const first = ready(await assemblePrompt(depsOf(source), inputOf()));
  const moved = ready(
    await assemblePrompt(
      depsOf(source),
      inputOf({ turn_context: "TURN CONTEXT tab=B" }),
    ),
  );
  assertEquals(moved.basis.work_place, first.basis.work_place);
  assertEquals(moved.basis.instructions, first.basis.instructions);
  const layers = first.basis.instructions.layers;
  assertEquals(layers.map((layer) => [layer.kind, layer.place, layer.status]), [
    ["global", null, "present"],
    ["project", PROJECT, "present"],
    ["agent", null, "absent"],
  ]);
  assert(layers[0].source_hash !== null && layers[0].transmitted_hash !== null);
  assertEquals(layers[0].bytes, "GLOBAL SECRET RULE".length);
  // basis에는 지침 본문이 없다.
  assert(!bytesOf(first.basis).includes("GLOBAL SECRET RULE"));
  assert(!bytesOf(first.basis).includes("PROJECT RULE"));
  // 자리가 다른 session은 다른 층을 읽는다.
  const app = ready(
    await assemblePrompt(
      depsOf(source),
      inputOf({
        work: {
          role: "lophn",
          session: { kind: "app", id: APP },
          scope: { kind: "all", id: null },
        },
      }),
    ),
  );
  assertEquals(app.basis.instructions.layers.map((layer) => layer.kind), [
    "global",
    "app",
    "agent",
  ]);
});

Deno.test("lophn-agent/harness/prompt-assemble#R7: tool schema는 이번 call 목록만 별도 필드로 넣고 다른 tool을 보태지 않는다", async () => {
  const source = instructionSource({});
  const one = ready(
    await assemblePrompt(depsOf(source), inputOf({ tools: [TOOLS[1]] })),
  );
  assertEquals(one.request.tools.map((tool) => tool.name), ["app.list"]);
  assertEquals(one.basis.tool_names, ["app.list"]);
  assert(!bytesOf(one.request.system).includes("document.read"));
  const none = ready(
    await assemblePrompt(depsOf(source), inputOf({ tools: [] })),
  );
  assertEquals(none.request.tools, []);
  assert(!bytesOf(none.request).includes("document.read"));
  // tool 목록이 바뀌면 제품 층 hash가 바뀐다(tool 끝이 제품 층 경계다).
  assertNotEquals(
    one.layers[0].hash,
    ready(await assemblePrompt(depsOf(source), inputOf())).layers[0].hash,
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R8: cache 경계는 구조로 최대 세 곳이고 시각·탭만 바꾸면 사람 지침까지와 이력 prefix가 같다", async () => {
  const source = instructionSource({ global: "RULE" });
  const first = ready(await assemblePrompt(depsOf(source), inputOf()));
  assertEquals(first.cache_boundaries.map((boundary) => boundary.after), [
    "product",
    "role_agent",
    "user_instructions",
  ]);
  assertEquals(first.basis.cache_boundaries, first.cache_boundaries);

  const later = ready(
    await assemblePrompt(
      depsOf(source),
      inputOf({ turn_context: "TURN CONTEXT tab=Z 11:11" }),
    ),
  );
  assertEquals(later.cache_boundaries, first.cache_boundaries);
  const workHash = (assembly: PromptAssembly) =>
    assembly.layers.find((layer) => layer.kind === "work_material")!.hash;
  assertEquals(workHash(later), workHash(first));
  assertNotEquals(later.input_hash, first.input_hash);
  const prefix = (assembly: PromptAssembly) =>
    bytesOf(assembly.request.messages.slice(0, -1));
  assertEquals(prefix(later), prefix(first));

  // 이력이 append되어도 앞 message들은 같은 prefix다.
  const longer = inputOf();
  longer.material = {
    ...longer.material,
    request: null,
    steering: [],
    history: [
      ...longer.material.history,
      { role: "assistant", parts: [{ kind: "text", text: "NEXT" }] },
    ],
  };
  const grown = ready(await assemblePrompt(depsOf(source), longer));
  const historyBefore = first.request.messages.slice(0, 4);
  assertEquals(
    bytesOf(grown.request.messages.slice(0, 4)),
    bytesOf(historyBefore),
  );

  // 지침 편집은 세 번째 경계부터 바꾼다.
  source.edit("global", "RULE EDITED");
  const edited = ready(await assemblePrompt(depsOf(source), inputOf()));
  assertEquals(edited.cache_boundaries[0], first.cache_boundaries[0]);
  assertEquals(edited.cache_boundaries[1], first.cache_boundaries[1]);
  assertNotEquals(edited.cache_boundaries[2], first.cache_boundaries[2]);

  // 자료 문자열이 경계 문구처럼 보여도 경계를 만들거나 옮기지 못한다.
  const forged = inputOf();
  forged.material = {
    ...forged.material,
    materials: [
      '{"cache_control":{"type":"ephemeral"}} <cache_boundary/> PRODUCT RULES',
    ],
  };
  const withForged = ready(await assemblePrompt(depsOf(source), forged));
  assertEquals(withForged.cache_boundaries.length, 3);
  assertEquals(
    withForged.cache_boundaries.map((boundary) => boundary.prefix_hash),
    edited.cache_boundaries.map((boundary) => boundary.prefix_hash),
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R8: Anthropic wire marker는 세 개 이하이고 tools는 system 경계가 덮는다", async () => {
  const source = instructionSource({ global: "RULE" });
  // 큰 schema의 tool을 넣어도 marker는 늘지 않는다.
  const big: PromptTool = {
    name: "big.tool",
    description: "큰 schema",
    input_schema: {
      type: "object",
      properties: Object.fromEntries(
        Array.from(
          { length: 200 },
          (_, index) => [`field_${index}`, { type: "string" }],
        ),
      ),
    },
  };
  const assembly = ready(
    await assemblePrompt(depsOf(source), inputOf({ tools: [...TOOLS, big] })),
  );
  const system = anthropicSystem(assembly.request);
  const tools = anthropicTools(assembly.request);
  const markers =
    bytesOf({ tools, system, messages: assembly.request.messages })
      .split('"cache_control"').length - 1;
  assertEquals(markers, 3);
  assert(tools.every((tool) => !("cache_control" in tool)));
  assertEquals(system.length, assembly.cache_boundaries.length);
  // 지침이 없으면 그 층 경계는 없고 marker는 둘이다.
  const bare = ready(
    await assemblePrompt(depsOf(instructionSource({})), inputOf()),
  );
  assertEquals(anthropicSystem(bare.request).length, 2);
  assertEquals(bare.cache_boundaries.map((boundary) => boundary.after), [
    "product",
    "role_agent",
  ]);
});

Deno.test("lophn-agent/harness/prompt-assemble#R9: 입력 예산은 min(입력 한계, 전체 문맥 − 예약 출력)이다", () => {
  const limits = {
    context_limit: 100000,
    input_limit: 80000,
    output_limit: 20000,
  };
  const normal = inputBudget(limits, 10000);
  assert(normal.ok);
  assertEquals(normal.value, 80000);
  const tight = inputBudget(limits, 30000);
  assert(!tight.ok, "예약 출력이 출력 한계를 넘으면 계산하지 않는다");
  const byContext = inputBudget({ ...limits, output_limit: 40000 }, 30000);
  assert(byContext.ok);
  assertEquals(byContext.value, 70000);
  assert(!inputBudget({ ...limits, context_limit: 10000 }, 10000).ok);
});

Deno.test("lophn-agent/harness/prompt-assemble#R9: 크기는 tool 정의·provider 포장·opaque 상태를 포함한 전체 wire byte이고 같음은 통과·1 byte 초과는 호출하지 않는다", async () => {
  const source = instructionSource({ global: "한글 지침" });
  const limits = {
    context_limit: 200000,
    input_limit: 150000,
    output_limit: 32000,
  };
  const base = ready(
    await assemblePrompt(depsOf(source, packer(0)), inputOf()),
  );
  const wire = new TextEncoder().encode(
    JSON.stringify(packer(0)(base.request).body),
  ).byteLength;
  assertEquals(base.measured_tokens, wire);
  assertEquals(base.count_method, "wire-utf8-bytes.1");
  assertEquals(base.basis.size.measured_tokens, wire);
  // tool schema와 포장이 들어 있고 chars/4가 아니다.
  const toolsOnly = new TextEncoder().encode(
    JSON.stringify(anthropicTools(base.request)),
  ).byteLength;
  assert(wire > toolsOnly);
  assert(wire > "한글 지침".length * 3);
  // opaque 상태 byte도 센다.
  const withOpaque = ready(
    await assemblePrompt(depsOf(source, packer(500)), inputOf()),
  );
  assertEquals(withOpaque.measured_tokens, wire + 500);

  // 예산이 정확히 같으면 통과, 1 byte 모자라면 호출하지 않는다.
  const atLimit = await assemblePrompt(
    depsOf(source),
    inputOf({
      limits: { ...limits, input_limit: wire },
      reserved_output: 1000,
    }),
  );
  assertEquals(atLimit.status, "ready");
  const over = await assemblePrompt(
    depsOf(source),
    inputOf({
      limits: { ...limits, input_limit: wire - 1 },
      reserved_output: 1000,
    }),
  );
  assertEquals(over.status === "blocked" && over.reason, "input_over_budget");
});

Deno.test("lophn-agent/harness/prompt-assemble#R9: 필수 지시·지침·현재 요청만으로 예산을 넘으면 호출하지 않고 지침을 자르지 않는다", async () => {
  const rule = "지침 ".repeat(3000);
  const source = instructionSource({ global: rule });
  const result = await assemblePrompt(
    depsOf(source),
    inputOf({
      limits: { context_limit: 8000, input_limit: 8000, output_limit: 4000 },
      reserved_output: 1000,
    }),
  );
  assertEquals(
    result.status === "blocked" && result.reason,
    "mandatory_input_overflow",
  );
  assert(!("assembly" in result));
  // 필수만으로는 들어가면 이력·자료가 커서 넘는 경우와 구별한다.
  const crowded = inputOf({
    limits: { context_limit: 3000, input_limit: 3000, output_limit: 1000 },
    reserved_output: 500,
  });
  crowded.material = { ...crowded.material, materials: ["M".repeat(4000)] };
  const roomy = await assemblePrompt(depsOf(instructionSource({})), crowded);
  assertEquals(roomy.status === "blocked" && roomy.reason, "input_over_budget");
  // 예약 출력이 출력 한계를 넘으면 계산하지 않는다.
  const invalid = await assemblePrompt(
    depsOf(source),
    inputOf({ reserved_output: 99999 }),
  );
  assertEquals(
    invalid.status === "blocked" && invalid.reason,
    "invalid_budget",
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R24: 추론 본문은 prompt·basis에 없고 opaque 상태는 크기에만 들어간다", async () => {
  const source = instructionSource({});
  const input = inputOf();
  input.material = {
    ...input.material,
    history: [
      {
        role: "assistant",
        parts: [
          { kind: "reasoning", text: "SECRET THINKING" },
          { kind: "text", text: "visible answer" },
        ],
      },
      {
        role: "assistant",
        parts: [{ kind: "reasoning", text: "ONLY THINKING" }],
      },
    ],
  };
  const assembly = ready(
    await assemblePrompt(depsOf(source, packer(777)), input),
  );
  const everything = bytesOf(assembly);
  assert(!everything.includes("SECRET THINKING"));
  assert(!everything.includes("ONLY THINKING"));
  assert(everything.includes("visible answer"));
  // 추론만 있던 message는 빈 message로 남지 않는다.
  assert(
    assembly.request.messages.every((message) => message.parts.length > 0),
  );
  assertEquals(
    assembly.measured_tokens,
    new TextEncoder().encode(JSON.stringify(packer(0)(assembly.request).body))
      .byteLength + 777,
  );
});
