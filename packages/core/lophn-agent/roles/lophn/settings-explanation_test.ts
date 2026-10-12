import { assert, assertEquals } from "@std/assert";
import {
  type EffectiveSetting,
  effectiveSettingSchema,
  type SettingDefinitionOutput,
  settingDefinitionSchema,
} from "@lophn/protocol/server";
import { explainSetting } from "./settings-explanation.ts";

const SECRET_VALUE = ["sk", "live", "fixture"].join("-");

function syntheticDefinition(
  overrides: Partial<SettingDefinitionOutput> & { default?: unknown } = {},
): SettingDefinitionOutput {
  const parsed: Record<string, unknown> = {
    key: "fixture.summary_model",
    owner: "lophn-agent/presets",
    display_name_key: "settings.fixture.summary_model.label",
    description: "The model used when a Preset writes a summary.",
    value_meaning_key: "settings.fixture.summary_model.value",
    default_meaning_key: "settings.fixture.summary_model.default",
    affected_features: ["Preset", "For summaries"],
    risk_key: "settings.fixture.summary_model.risk",
    revert_key: "settings.fixture.summary_model.revert",
    constraints: { type: "string", minLength: 1 },
    required: false,
    layers: ["common"],
    apply_at: "next_run",
    apply_at_key: "settings.fixture.summary_model.apply",
    machine_local: true,
    value_type: { type: "string" },
    default_present: true,
    default: "same-as-decisions",
    ...overrides,
  };
  if (parsed.default_present !== true) delete parsed.default;
  return settingDefinitionSchema.parse(parsed);
}

function syntheticEffective(
  overrides: Partial<EffectiveSetting> = {},
): EffectiveSetting {
  return effectiveSettingSchema.parse({
    key: "fixture.summary_model",
    resolved: true,
    value: "summary-model",
    source_layer: "common",
    choices: [{
      layer: "common",
      key: "fixture.summary_model",
      value: "summary-model",
    }],
    revision: 2,
    apply_at: "next_run",
    ...overrides,
  });
}

Deno.test("lophn-agent/roles/lophn#R20 synthetic wording-key projection drops a secret supplied as value and default", () => {
  const definition = syntheticDefinition({ default: SECRET_VALUE });
  const effective = syntheticEffective({ value: SECRET_VALUE });
  const explained = explainSetting({ definition, effective });
  const rendered = JSON.stringify(explained);
  assert(!rendered.includes(SECRET_VALUE));
  assert(!rendered.includes("summary-model"));
  assert(!rendered.includes("same-as-decisions"));
  assertEquals(explained.differsFromDefault, false);

  const nullBuiltin = explainSetting({
    definition: syntheticDefinition({ default: null }),
    effective: syntheticEffective({
      value: null,
      source_layer: "builtin",
      choices: [],
    }),
  });
  assertEquals(nullBuiltin.source, "builtin");
  assertEquals(nullBuiltin.resolved, true);
  assertEquals(nullBuiltin.differsFromDefault, false);
});
