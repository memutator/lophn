import { z } from "zod";
import { ok } from "../../../packages/base/mod.ts";
import {
  defaultHarnessSetting,
  harnessEnabledSetting,
  harnessProfileSetting,
} from "../../protocol/coding-agent/mod.ts";
import type { CommandDefinition, Tx } from "../../protocol/server/mod.ts";
import { defineCommand } from "../../protocol/base/mod.ts";
import type { SettingDefinition } from "../../protocol/config/mod.ts";
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
    // 이미 apply가 넣은 선택을 범위 밖 값으로 바꾸는 seed도 같은 command로 남긴다(R22).
    tx.sql.run(
      "insert into setting_choices (layer, key, value) values ('common', ?, ?) on conflict (layer, key) do update set value = excluded.value",
      [input.key, input.value],
    );
    return ok({ recorded: true });
  },
};

// 테스트 전용 question event 심기 command(platform/settings#R29). lophn-agent의
// QuestionCreated·QuestionAnswered event 모양을 실제 임시 ledger에 남긴다.
export const seedQuestion = defineCommand({
  resource: "settings",
  method: "seed-question",
  name: "settings.tests.seed_question",
  input: z.object({
    group: z.string(),
    question: z.string(),
    option_key: z.string(),
    changes: z.array(z.json()),
    with_answer: z.boolean(),
    answer_actor: z.string(),
    answer_option: z.string().nullable(),
  }),
  output: z.object({ seeded: z.boolean() }),
  actors: ["user", "machine"],
  errors: [],
});

const seedQuestionCommand: CommandDefinition<typeof seedQuestion> = {
  route: seedQuestion,
  handle(tx: Tx, _ctx, input) {
    // question event 모양은 lophn-agent의 QuestionCreated·QuestionAnswered
    // payload와 같다. 만든 actor는 fixture seeder다(agent 대신 임시 ledger의
    // event 모양만 남긴다). platform은 이 event를 SQL로만 읽는다(R29).
    tx.sql.run(
      "insert into events (type, subject, actor, run, payload, at) values (?, ?, ?, ?, ?, ?)",
      [
        "QuestionCreated",
        input.group,
        _ctx.actor,
        null,
        JSON.stringify({
          run: "run_01arz3ndektsv4rrffq69g5fav",
          session: null,
          questions: [{
            id: input.question,
            options: [{ key: input.option_key, changes: input.changes }],
          }],
        }),
        tx.now(),
      ],
    );
    if (input.with_answer) {
      tx.sql.run(
        "insert into events (type, subject, actor, run, payload, at) values (?, ?, ?, ?, ?, ?)",
        [
          "QuestionAnswered",
          input.group,
          input.answer_actor,
          null,
          JSON.stringify({
            created_seq: "1",
            answers: [{
              question: input.question,
              answer: input.answer_option === null
                ? { kind: "text", option_key: null, text_blob: "0".repeat(64) }
                : {
                  kind: "option",
                  option_key: input.answer_option,
                  text_blob: null,
                },
            }],
            binding_hash: null,
          }),
          tx.now(),
        ],
      );
    }
    return ok({ seeded: true });
  },
};

// settings 설정의 apply·reload·history·read를 같은 registry로 등록한다(R17-R25).
// coding-agent의 harness 설정 3개(coding-agent/harnesses contract, machine_local:
// true)는 소유 concern의 schema를 그대로 등록한다(platform/settings#R31).
export function createLedgerTestRegistration() {
  const registry = new SettingRegistry([
    width,
    tracking,
    harnessChoice,
    harnessEnabledSetting,
    defaultHarnessSetting,
    harnessProfileSetting,
  ]);
  const commands = createSettingsCommands(registry);
  return {
    schemaSteps: SETTINGS_SCHEMA_STEPS,
    commands: [commands.apply, commands.reload],
    testCommands: [recordChoiceCommand, seedQuestionCommand],
    reads: [
      settingsDefinitionsRead(registry),
      settingsGetRead(registry),
      settingsHistoryRead(registry),
    ],
  };
}
