import { canonicalize } from "@lophn/base";
import type {
  EffectiveSetting,
  SettingApplyAt,
  SettingDefinitionOutput,
} from "@lophn/protocol/config";

export type SettingExplanationInput = {
  definition: SettingDefinitionOutput;
  effective: EffectiveSetting;
};

// shell wording resolver가 없다. 문장으로 바꾸지 않고 공개 wording key만 투영한다.
export type SettingExplanation = {
  key: string;
  description: string;
  displayNameKey: string;
  valueMeaningKey: string;
  defaultMeaningKey: string;
  affectedFeatures: readonly string[];
  riskKey: string;
  revertKey: string;
  constraints: Readonly<Record<string, unknown>>;
  resolved: boolean;
  source: "builtin" | "common" | "unresolved";
  differsFromDefault: boolean | "unknown";
  applyAt: SettingApplyAt;
  applyAtKey: string;
};

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right);
}

export function explainSetting(
  input: SettingExplanationInput,
): SettingExplanation {
  const { definition, effective } = input;
  if (definition.key !== effective.key) {
    throw new Error(
      "setting definition and effective setting use different keys",
    );
  }
  if (definition.apply_at !== effective.apply_at) {
    throw new Error(
      `setting apply time does not match its definition: ${definition.key}`,
    );
  }
  const source = effective.resolved ? effective.source_layer : "unresolved";
  if (!source) {
    throw new Error(`resolved setting has no source: ${definition.key}`);
  }
  const differsFromDefault = !effective.resolved || !definition.default_present
    ? "unknown"
    : !sameJson(effective.value, definition.default);
  return {
    key: definition.key,
    description: definition.description,
    displayNameKey: definition.display_name_key,
    valueMeaningKey: definition.value_meaning_key,
    defaultMeaningKey: definition.default_meaning_key,
    affectedFeatures: definition.affected_features,
    riskKey: definition.risk_key,
    revertKey: definition.revert_key,
    constraints: definition.constraints,
    resolved: effective.resolved,
    source: source === "unresolved" ? "unresolved" : source,
    differsFromDefault,
    applyAt: definition.apply_at,
    applyAtKey: definition.apply_at_key,
  };
}
