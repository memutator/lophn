import { canonicalize, fingerprint, sha256Hex } from "../../../base/mod.ts";
import {
  type InstructionDeps,
  instructionPlace,
  resolveInstructions,
} from "../../instructions/mod.ts";
import { inputBudget, measureWire } from "./budget.ts";
import {
  instructionsText,
  normalizeTools,
  systemBlocks,
  withTurnContext,
  workMessages,
} from "./layers.ts";
import {
  type AssembleResult,
  type BlockedReason,
  type CacheBoundary,
  type ContextBasis,
  COUNT_METHOD,
  PROMPT_RULE_VERSION,
  type PromptInput,
  type PromptLayer,
  type PromptLayerKind,
  type PromptRequest,
  type SystemLayerKind,
  type WirePacker,
} from "./model.ts";

export type PromptDeps = InstructionDeps & { pack: WirePacker };

function blocked(reason: BlockedReason, message: string): AssembleResult {
  return { status: "blocked", reason, message };
}

function blank(text: string | undefined): boolean {
  return text === undefined || text.trim() === "";
}

function layerHash(content: unknown): Promise<string> {
  return sha256Hex(canonicalize(content));
}

// model call 직전마다 부른다. 사람 지침은 이 안에서 다시 읽어(resolveInstructions) 그 call의 고정
// snapshot으로 쓴다. 필수 층(제품·역할·지침)이 없거나 입력 예산을 필수만으로 넘으면 blocked이고
// 호출하지 않는다. 지침·요청·steering은 줄이지 않는다.
export async function assemblePrompt(
  deps: PromptDeps,
  input: PromptInput,
): Promise<AssembleResult> {
  if (input.product === null || blank(input.product.instructions)) {
    return blocked("product_missing", "제품 공통 지시가 없다");
  }
  if (input.role === null || blank(input.role.instructions)) {
    return blocked("role_missing", "역할 지시가 없다");
  }
  const budget = inputBudget(input.limits, input.reserved_output);
  if (!budget.ok) return blocked("invalid_budget", budget.error.message);

  const place = instructionPlace(input.work);
  const resolved = await resolveInstructions(deps, {
    place,
    attachments: input.attachments,
  });
  if (!resolved.ok) {
    return blocked("instructions_unavailable", "사람 지침을 읽지 못했다");
  }
  const resolution = resolved.value;
  if (resolution.status === "blocked") {
    return blocked("instructions_blocked", resolution.message);
  }

  const tools = normalizeTools(input.tools);
  const system = systemBlocks({
    product: input.product.instructions,
    role: input.role.instructions,
    preset: input.role.preset_prompt,
    instructions: instructionsText(resolution.layers),
  });

  // 필수만(지시·tool·지침·현재 요청·steering)으로 예산을 넘으면 줄일 수 없으므로 호출하지 않는다.
  const required: PromptRequest = {
    system,
    tools,
    messages: workMessages({
      purpose: null,
      run_facts: null,
      continuation_summary: null,
      materials: [],
      compaction_summary: null,
      history: [],
      request: input.material.request,
      steering: input.material.steering,
    }),
  };
  if (measureWire(deps.pack(required)) > budget.value) {
    return blocked(
      "mandatory_input_overflow",
      "필수 지시와 현재 요청만으로 입력 예산을 넘는다",
    );
  }

  const work = workMessages(input.material);
  const request: PromptRequest = {
    system,
    tools,
    messages: withTurnContext(work, input.turn_context),
  };
  const measured = measureWire(deps.pack(request));
  if (measured > budget.value) {
    return blocked("input_over_budget", "입력이 입력 예산을 넘는다");
  }

  const productLayer = system[0];
  const roleLayer = system[1];
  const instructionLayer = system.find((block) =>
    block.layer === "user_instructions"
  );
  const layers: PromptLayer[] = [];
  const contents: [PromptLayerKind, unknown][] = [
    ["product", { instructions: productLayer.text, tools }],
    ["role_preset", { instructions: roleLayer.text }],
    ["user_instructions", { text: instructionLayer?.text ?? "" }],
    ["work_material", { messages: work }],
  ];
  if (input.turn_context !== null) {
    contents.push(["turn_context", { text: input.turn_context }]);
  }
  for (const [kind, content] of contents) {
    layers.push({ kind, content, hash: await layerHash(content) });
  }

  // 사람 지침까지의 세 층은 구조로 정한 cache 경계다. 앞 층 hash를 이어 prefix hash를 만든다.
  const cache_boundaries: CacheBoundary[] = [];
  let prefix = "";
  for (const layer of layers.slice(0, 3)) {
    prefix = await sha256Hex(`${prefix}\n${layer.hash}`);
    const after = layer.kind as SystemLayerKind;
    if (system.some((block) => block.layer === after)) {
      cache_boundaries.push({ after, prefix_hash: prefix });
    }
  }

  const basis: ContextBasis = {
    rule_version: PROMPT_RULE_VERSION,
    work_place: place,
    instructions: {
      layers: resolution.layers.map((layer) => ({
        kind: layer.kind,
        place: layer.place,
        document: layer.document,
        version: layer.version,
        source_hash: layer.source_hash,
        transmitted_hash: layer.transmitted_hash,
        status: layer.status,
        bytes: layer.bytes,
      })),
      total_bytes: resolution.total_bytes,
    },
    layer_hashes: layers.map((layer) => ({
      kind: layer.kind,
      hash: layer.hash,
    })),
    cache_boundaries,
    tool_names: tools.map((tool) => tool.name),
    size: {
      input_budget: budget.value,
      reserved_output: input.reserved_output,
      measured_tokens: measured,
      count_method: COUNT_METHOD,
    },
  };
  return {
    status: "ready",
    assembly: {
      rule_version: PROMPT_RULE_VERSION,
      layers,
      basis,
      cache_boundaries,
      input_budget: budget.value,
      reserved_output: input.reserved_output,
      measured_tokens: measured,
      count_method: COUNT_METHOD,
      request,
      input_hash: await fingerprint(request),
      basis_hash: await fingerprint(basis),
    },
  };
}
