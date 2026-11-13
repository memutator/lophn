import {
  type CatalogEntry,
  type OptionValues,
  type ResolvedModel,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Result } from "../../../base/mod.ts";
import { err, ok } from "../../../base/mod.ts";
import { confirmedSupport } from "./model.ts";
import { resolveOptionValues } from "./options.ts";

// ModelChoice를 catalog·provider의 현재 정보로 검증한다. 이 모듈은 검사 규칙이고 저장은
// 선택을 가진 쪽의 몫이다. 임의 한계(128000·8192)나 tool 지원을 추측하지 않는다.
// 요청에 싣는 값(sent_model_name·request_patch·request_headers)은 호출 형식을 아는 쪽이
// wire.ts의 translateOptions로 채운다. 여기서는 바꾸지 않은 model 이름과 빈 조각이다.

type ProviderNames = {
  // false는 구독 계정의 허락 목록 밖이라 거절한다. true는 catalog나 provider가 알려 준 목록에 있는 이름이고
  // null은 아무 목록에도 없는 직접 적은 이름(미확인)이다. 목록은 고를 수 있는지를 정하지 않는다.
  modelListed(modelName: string): boolean | null;
};

type NamedLimits = {
  // 사람이 명시한 양의 입력·출력·전체 문맥 한계와 text·tool 지원 정보다.
  context_limit: number;
  input_limit: number;
  output_limit: number;
  supports_tools: boolean;
};

// 첫 성공 호출에서 unverified 표시를 해제하는 것은 호출 기록의 몫이다.
function verificationOf(listed: boolean | null): "verified" | "unverified" {
  return listed === true ? "verified" : "unverified";
}

type SelectionInput = {
  purpose: "judgment" | "organizing";
  provider: string;
  // turn 시작에 고정한 provider의 credential 판. 인증 없음(loopback)만 null이다.
  credential_revision: number | null;
  model_name: string;
  // 고른 축의 값이다. 없는 축은 모델에 맡김이고 default를 채우는 일은 여기서 한다.
  option_values: OptionValues;
  needs_tools: boolean;
};

// catalog 밖 model의 명시 대체 항목이다. option 축을 모른다.
const EXPLICIT_ENTRY = (
  modelName: string,
  supportsTools: boolean | null,
): CatalogEntry => ({
  provider_definition: "explicit",
  model_name: modelName,
  protocol: null,
  context_limit: null,
  input_limit: null,
  output_limit: null,
  supports_tools: supportsTools,
  input_media: ["text"],
  output_media: ["text"],
  options: null,
  preview: null,
  deprecated: null,
  source: "user",
  source_revision: "explicit",
  checked_at: null,
  received_at: null,
  price_basis: null,
});

// 알려진 텍스트 입력·출력 미지원과 필요한 tool call 미지원 model은 거절한다.
// tool call은 자기 model 호출(organizing 포함)이라 필요하다. judgment·organizing 구별은 없다.
function rejectSelection(
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

// 고른 option 값을 검증하고 default를 채운다. option 축은 catalog 자료만 말하므로 catalog
// 항목이 없는 model에는 어떤 값도 고를 수 없다.
function selectedOptions(
  entry: CatalogEntry | undefined,
  values: OptionValues,
): Result<Record<string, string>> {
  if (entry !== undefined) return resolveOptionValues(entry, values);
  if (Object.keys(values).length > 0) {
    return err({
      code: "invalid_input",
      message: "option을 확인할 수 없는 model에는 option 값을 고를 수 없다",
    });
  }
  return ok({});
}

// selection을 catalog의 현재 정보로 검증해 ResolvedModel로 만든다. entry가 없으면
// 사람 명시 한계가 필요하다. catalog 밖이면서 명시 한계가 없으면 사용할 수
// 없다. 첫 판은 text 입력·출력만 사용한다.
export function resolveSelection(
  selection: SelectionInput,
  entry: CatalogEntry | undefined,
  provider: ProviderNames,
  explicit: NamedLimits | undefined,
): Result<ResolvedModel> {
  const listed = provider.modelListed(selection.model_name);
  if (listed === false) {
    // 구독 계정의 허락 목록 밖이다.
    return err({
      code: "not_found",
      message: "계정이 허락한 model 목록에 없는 이름이다",
    });
  }
  const optionValues = selectedOptions(entry, selection.option_values);
  if (!optionValues.ok) return optionValues;
  const verified = verificationOf(listed);
  const support = confirmedSupport(entry);
  const common = {
    purpose: selection.purpose,
    credential_revision: selection.credential_revision,
    provider: selection.provider,
    model_name: selection.model_name,
    sent_model_name: selection.model_name,
    verification: verified,
    option_values: optionValues.value,
    request_patch: {},
    request_headers: {},
    // catalog가 모르는 media는 text뿐인 것으로 둔다. image를 받는지는 여기서 정해 tool 목록에 쓴다.
    input_media: entry?.input_media ?? ["text" as const],
    output_media: entry?.output_media ?? ["text" as const],
  };
  let limits: ResolvedModel;
  if (support !== undefined) {
    limits = {
      ...common,
      context_limit: support.context_limit,
      input_limit: support.input_limit,
      output_limit: support.output_limit,
      supports_tools: support.supports_tools,
      price_basis: entry?.price_basis ?? null,
      basis: {
        source: "catalog",
        context_limit:
          entry?.context_limit !== undefined ? "catalog" : "unknown",
        input_limit: entry?.input_limit !== undefined ? "catalog" : "unknown",
        output_limit: entry?.output_limit !== undefined ? "catalog" : "unknown",
        supports_tools:
          entry?.supports_tools !== undefined ? "catalog" : "unknown",
        model_listed: listed === true ? "provider_list" : "unknown",
      },
    };
  } else if (explicit !== undefined) {
    // catalog 밖 model은 사람이 명시한 양의 한계와 text·tool 지원이 있어야 쓸 수
    // 있다. 명시 보완은 catalog 사실과 구별된다(basis.source).
    limits = {
      ...common,
      context_limit: explicit.context_limit,
      input_limit: explicit.input_limit,
      output_limit: explicit.output_limit,
      supports_tools: explicit.supports_tools,
      price_basis: null,
      basis: {
        source: "user_explicit",
        model_listed: listed === true ? "provider_list" : "unknown",
      },
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

// turn은 시작한 effort를 유지하고 개별 요청은 그보다 높은 effort를 요청하지 못한다.
// turn이 effort를 고정하지 않았으면(모델에 맡김) 비교할 값이 없다. effort 밖 축은 약하고 강함을
// 비교할 이름 순서가 없어 이 검사가 바꾸지 않는다.

// 같음은 통과다. 바로 아래도 통과다.
