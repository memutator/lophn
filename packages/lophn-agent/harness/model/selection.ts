import {
  type CatalogEntry,
  reasoningLevelSchema,
  type ResolvedModel,
} from "../../../contracts/lophn-agent/mod.ts";
import type { JsonObject } from "../../../contracts/platform/mod.ts";
import type { Result } from "../../../base/mod.ts";
import { err, ok } from "../../../base/mod.ts";
import { type ReasoningArgs, reasoningArgs } from "./reasoning.ts";
import { nonTextTokenBound, textTokenUpperBound } from "./budget.ts";
import { confirmedSupport } from "./model.ts";

export { type ReasoningArgs, reasoningArgs };

// PresetModelSelection을 catalog·provider의 현재 정보로 검증한다. 이 모듈은
// 검사 규칙이고 저장은 Preset의 몫이다. 임의 한계(128000·8192)나 tool 지원을
// 추측하지 않는다(R11, R13).

export type ProviderNames = {
  // provider 목록에 그 model 이름이 있는지. 목록을 확인하지 못했으면 null이다(R10).
  modelListed(modelName: string): boolean | null;
};

export type NamedLimits = {
  // 사람이 명시한 양의 입력·출력·전체 문맥 한계와 text·tool 지원 정보다(R13).
  context_limit: number;
  input_limit: number;
  output_limit: number;
  supports_tools: boolean;
};

// 목록에 없는 이름은 저장 거절이고, 목록을 확인하지 못했으면 미확인으로 저장한다
// (R10). 첫 성공 호출에서 unverified 표시를 해제하는 것은 호출 기록의 몫이다.
export function verificationOf(
  listed: boolean | null,
): "verified" | "unverified" {
  return listed === true ? "verified" : "unverified";
}

export type SelectionInput = {
  purpose: "judgment" | "organizing";
  provider: string;
  credentials: string[];
  model_name: string;
  reasoning_level: string;
  needs_tools: boolean;
  options: JsonObject;
};

// catalog 밖 model의 명시 대체 항목이다. 조절 방식을 모른다(R16).
const EXPLICIT_ENTRY = (
  modelName: string,
  supportsTools: boolean | null,
): CatalogEntry => ({
  provider_definition: "explicit",
  model_name: modelName,
  context_limit: null,
  input_limit: null,
  output_limit: null,
  supports_tools: supportsTools,
  input_media: ["text"],
  output_media: ["text"],
  reasoning: {
    mode: "unknown",
    levels: [],
    minimum_budget: null,
    maximum_budget: null,
    default_level: null,
  },
  preview: null,
  deprecated: null,
  source: "user",
  source_revision: "explicit",
  checked_at: null,
  received_at: null,
  price_basis: null,
});

export type SelectionError =
  | "text_input_unsupported"
  | "text_output_unsupported"
  | "tools_unsupported"
  | "named_level_unsupported"
  | "toggle_level_unsupported"
  | "budget_level_out_of_range"
  | "unknown_mode";

// 알려진 텍스트 입력·출력 미지원과 필요한 tool call 미지원 model은 거절한다(R11).
// tool call은 자기 model 호출(organizing 포함)이라 필요하다. judgment·organizing 구별은 없다.
export function rejectSelection(
  entry: CatalogEntry,
  needsTools: boolean,
): Result<void> {
  const input = entry.input_media;
  if (input !== null && !input.includes("text")) {
    return err({
      code: "invalid_input",
      message: "텍스트 입력을 지원하지 않는 model이다",
    });
  }
  const output = entry.output_media;
  if (output !== null && !output.includes("text")) {
    return err({
      code: "invalid_input",
      message: "텍스트 출력을 지원하지 않는 model이다",
    });
  }
  if (needsTools && entry.supports_tools === false) {
    return err({
      code: "invalid_input",
      message: "tool call을 지원하지 않는 model이다",
    });
  }
  return ok(undefined);
}

// selection을 catalog의 현재 정보로 검증해 ResolvedModel로 만든다. entry가 없으면
// 사람 명시 한계가 필요하다(R13). catalog 밖이면서 명시 한계가 없으면 사용할 수
// 없다. 첫 판은 text 입력·출력만 사용한다(R19).
export function resolveSelection(
  selection: SelectionInput,
  entry: CatalogEntry | undefined,
  provider: ProviderNames,
  explicit: NamedLimits | undefined,
): Result<ResolvedModel> {
  const listed = provider.modelListed(selection.model_name);
  if (listed === false) {
    // provider의 현재 목록에 없으면 거절이다(R10).
    return err({
      code: "not_found",
      message: "provider 목록에 없는 model 이름이다",
    });
  }
  const verified = verificationOf(listed);
  const support = confirmedSupport(entry);
  const level = reasoningLevelSchema.safeParse(selection.reasoning_level);
  if (!level.success) {
    return err({
      code: "invalid_input",
      message: "추론 수준이 수준 이름이 아니다",
    });
  }
  let limits: ResolvedModel;
  if (support !== undefined) {
    limits = {
      purpose: selection.purpose,
      credentials: [...selection.credentials],
      provider: selection.provider,
      model_name: selection.model_name,
      verification: verified,
      options: selection.options,
      reasoning_level: level.data,
      context_limit: support.context_limit,
      input_limit: support.input_limit,
      output_limit: support.output_limit,
      supports_tools: support.supports_tools,
      input_media: ["text"],
      output_media: ["text"],
      price_basis: entry?.price_basis ?? null,
      basis: {
        source: "catalog",
        context_limit: entry?.context_limit !== undefined
          ? "catalog"
          : "unknown",
        input_limit: entry?.input_limit !== undefined ? "catalog" : "unknown",
        output_limit: entry?.output_limit !== undefined ? "catalog" : "unknown",
        supports_tools: entry?.supports_tools !== undefined
          ? "catalog"
          : "unknown",
        model_listed: listed === true ? "provider_list" : "unknown",
      },
    };
  } else if (explicit !== undefined) {
    // catalog 밖 model은 사람이 명시한 양의 한계와 text·tool 지원이 있어야 쓸 수
    // 있다(R13). 명시 보완은 catalog 사실과 구별된다(basis.source).
    limits = {
      purpose: selection.purpose,
      credentials: [...selection.credentials],
      provider: selection.provider,
      model_name: selection.model_name,
      verification: verified,
      options: selection.options,
      reasoning_level: level.data,
      context_limit: explicit.context_limit,
      input_limit: explicit.input_limit,
      output_limit: explicit.output_limit,
      supports_tools: explicit.supports_tools,
      input_media: ["text"],
      output_media: ["text"],
      price_basis: null,
      basis: { source: "user_explicit" },
    };
  } else {
    return err({
      code: "invalid_input",
      message: "확인된 한계와 명시 한계가 없어 사용할 수 없다",
    });
  }
  const gate = rejectSelection(
    entry ??
      EXPLICIT_ENTRY(selection.model_name, explicit?.supports_tools ?? null),
    selection.needs_tools,
  );
  return gate.ok ? ok(limits) : gate;
}

// 호출 전 입력·예약 출력·전체 문맥 한계를 하나라도 넘으면 전송하지 않는다(R11).
export { nonTextTokenBound, textTokenUpperBound };

// 같음은 통과다. 바로 아래도 통과다(R11 확인).
export function withinLimits(
  limits: Pick<
    ResolvedModel,
    "context_limit" | "input_limit" | "output_limit"
  >,
  wholeRequestBytes: number,
  inputBytes: number,
  reservedOutputTokens: number,
): Result<void> {
  if (inputBytes > limits.input_limit) {
    return err({
      code: "invalid_input",
      message: "입력이 입력 한계를 넘는다",
    });
  }
  if (reservedOutputTokens > limits.output_limit) {
    return err({
      code: "invalid_input",
      message: "예약 출력이 출력 한계를 넘는다",
    });
  }
  if (wholeRequestBytes > limits.context_limit) {
    return err({
      code: "invalid_input",
      message: "전체 문맥이 문맥 한계를 넘는다",
    });
  }
  return ok(undefined);
}
