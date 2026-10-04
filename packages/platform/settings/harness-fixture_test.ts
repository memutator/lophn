import { z } from "zod";
import { ok } from "../../../packages/base/mod.ts";
import {
  type CommandDefinition,
  defineCommand,
  type SettingDefinition,
  type Tx,
} from "../../../packages/contracts/platform/mod.ts";
import {
  createSettingsCommands,
  SettingRegistry,
  settingsDefinitionsRead,
  settingsGetRead,
  settingsHistoryRead,
} from "./mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "./schema.ts";

const width: SettingDefinition<z.ZodNumber> = {
  key: "shell.reading_width",
  owner: "shell/workspace",
  display_name_key: "settings.reading_width.name",
  description: "settings.reading_width.description",
  value_meaning_key: "settings.reading_width.value",
  default_meaning_key: "settings.reading_width.default",
  affected_features: ["shell/workspace"],
  risk_key: "settings.reading_width.risk",
  revert_key: "settings.reading_width.revert",
  value_type: z.number().int().min(40).max(120),
  default_present: true,
  default: 80,
  required: false,
  constraints: { minimum: 40, maximum: 120, unit: "characters" },
  layers: ["common"],
  apply_at: "current_check",
  apply_at_key: "settings.reading_width.apply_at",
  machine_local: false,
};

const tracking: SettingDefinition<
  z.ZodObject<{ patterns: z.ZodArray<z.ZodString> }>
> = {
  key: "documents.tracking",
  owner: "documents/tracking",
  display_name_key: "settings.tracking.name",
  description: "settings.tracking.description",
  value_meaning_key: "settings.tracking.value",
  default_meaning_key: "settings.tracking.default",
  affected_features: ["documents/tracking"],
  risk_key: "settings.tracking.risk",
  revert_key: "settings.tracking.revert",
  value_type: z.object({ patterns: z.array(z.string()) }),
  default_present: true,
  default: { patterns: ["**/*.md"] },
  required: false,
  constraints: {},
  layers: ["common"],
  apply_at: "next_run",
  apply_at_key: "settings.tracking.apply_at",
  machine_local: false,
};

const harnessChoice: SettingDefinition<z.ZodNullable<z.ZodString>> = {
  key: "coding.harness",
  owner: "coding-agent/harnesses",
  display_name_key: "settings.harness.name",
  description: "settings.harness.description",
  value_meaning_key: "settings.harness.value",
  default_meaning_key: "settings.harness.default",
  affected_features: ["coding-agent/harnesses"],
  risk_key: "settings.harness.risk",
  revert_key: "settings.harness.revert",
  value_type: z.nullable(z.string()),
  default_present: true,
  default: null,
  required: false,
  constraints: {},
  layers: ["common"],
  apply_at: "next_run",
  apply_at_key: "settings.harness.apply_at",
  machine_local: false,
};

// 테스트 전용 command. probeWrite는 rollback되므로 원본 표 기록은
// writer transaction 안에서 dispatch하는 이 command로 남긴다(R2).
export const recordChoice = defineCommand({
  resource: "settings",
  method: "record-choice",
  name: "settings.tests.record_choice",
  input: z.object({ key: z.string(), value: z.string() }),
  output: z.object({ recorded: z.boolean() }),
  actors: ["user", "machine"],
  errors: [],
});

const recordChoiceCommand: CommandDefinition<typeof recordChoice> = {
  route: recordChoice,
  handle(tx: Tx, _ctx, input) {
    tx.sql.run(
      "insert into setting_choices (layer, key, value) values ('common', ?, ?)",
      [input.key, input.value],
    );
    return ok({ recorded: true });
  },
};

// settings 설정의 apply·reload·history·read를 같은 registry로 등록한다(R17-R25).
export function createLedgerTestRegistration() {
  const registry = new SettingRegistry([width, tracking, harnessChoice]);
  const commands = createSettingsCommands(registry);
  return {
    schemaSteps: SETTINGS_SCHEMA_STEPS,
    commands: [commands.apply, commands.reload],
    testCommands: [recordChoiceCommand],
    reads: [
      settingsDefinitionsRead(registry),
      settingsGetRead(registry),
      settingsHistoryRead(registry),
    ],
  };
}
