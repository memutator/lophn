import type { Result } from "../../base/mod.ts";
import type {
  CatalogEntry,
  PresetDefinition,
  ResolvedModel,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type NamedLimits,
  type ProviderNames,
  resolveSelection,
} from "../harness/model/mod.ts";
import { errItem, type PresetItemError } from "./model.ts";

// Preset의 model·organizing_model 선택을 T5 harness/model의 검사로 실제 검증한다
// (T5 사용). 임의 한계·fallback을 추측하지 않고(R6), catalog 밖 model은 사람이
// 명시한 양의 한계가 있어야 쓸 수 있다(R13). 목록에 없는 이름은 저장 거절이다(R10).

// model 선택 하나의 T5 검사. selection이 null이면 사용 판정을 실행 때 미룬다.
// organizing이 비면 같은 판의 model을 쓴다(펜딩이 아니라 같은 model). 둘 다
// 비면 실행 전 필수라 실행 때 거절이다(R6). 저장은 가능하다.
export function validateModelSelection(
  field: "model" | "organizing_model",
  selection: PresetDefinition["model"],
  deps: {
    // provider의 확인된 model 목록이다. 확인하지 못했으면 null이다(R10).
    modelListed: (provider: string, modelName: string) => boolean | null;
    // provider 안 존재하는 credential key 목록이다(R6).
    credentialKeys: (provider: string) => readonly string[];
    // preset의 model 선택을 T5 검사로 검증할 때 catalog의 현재 항목이다(R13).
    catalogEntry: (
      providerDefinition: string,
      modelName: string,
    ) => CatalogEntry | undefined;
  },
): Result<ResolvedModel | null, PresetItemError> {
  if (selection === null) {
    return { ok: true, value: null };
  }
  // credential은 provider 안 존재하는 key만 남긴다(R6).
  const known = deps.credentialKeys(selection.provider);
  if (known.length === 0) {
    return errItem(
      "not_found",
      `model.${field}.provider:${selection.provider}`,
      "그 provider의 credential을 확인할 수 없다",
    );
  }
  // 참고: 이 selection에는 credential key 이름 목록만 있어 key 존재 검사는
  // provider의 목록으로 본다. key마다 열림 검사는 실제 호출 때다(R6).
  const listed = deps.modelListed(selection.provider, selection.model_name);
  const entry = deps.catalogEntry("anthropic", selection.model_name);
  // provider의 확인 목록은 T5 ProviderNames로 전달한다. 확인하지 못했으면
  // null이고 T5가 미확인 저장을 결정한다(R10).
  const providerNames: ProviderNames = { modelListed: () => listed };
  const explicit = undefined as NamedLimits | undefined;
  const resolved = resolveSelection(
    {
      purpose: field === "model" ? "judgment" : "organizing",
      provider: selection.provider,
      credentials: [...selection.credentials],
      model_name: selection.model_name,
      reasoning_level: selection.reasoning_level,
      needs_tools: true,
      options: selection.options,
    },
    entry,
    providerNames,
    explicit,
  );
  if (!resolved.ok) {
    // T5의 거절 코드는 preset 항목 설명으로 좁힌다. details.item로 어느
    // 선택이 잘못되었는지 남긴다(R11).
    return errItem(
      "invalid_input",
      `model.${field}:${selection.provider}.${selection.model_name}`,
      resolved.error.message,
    );
  }
  return resolved;
}
