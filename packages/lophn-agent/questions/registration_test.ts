import { z } from "zod";
import { manualClock, ok } from "../../base/mod.ts";
import { ACTOR_KINDS, defineCommand } from "../../contracts/platform/mod.ts";
import type { LedgerTestRegistration } from "../../../apps/core/testing/ledger.ts";
import {
  createPresetCommands,
  createPresetReads,
  presetSchemaSteps,
} from "../presets/mod.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
  createAssignmentReads,
} from "../assignments/mod.ts";
import {
  createRunCommands,
  createRunReads,
  runSchemaSteps,
} from "../harness/run-loop/mod.ts";
import {
  conversationSchemaSteps,
  createConversationCommands,
  createConversationReads,
  hasUnappliedSteering,
} from "../conversation/mod.ts";
import { presetValidateDeps } from "../harness/run-loop/testing/mod.ts";
import {
  createQuestionCommands,
  createQuestionReads,
  questionSchemaSteps,
} from "./mod.ts";

// 질문 ledger 테스트 등록. preset·assignment·run 표와 같은 wire에 질문 명령·읽기를
// 붙이고, 질문의 기한 경계를 보려고 시계를 이 등록이 쥔다(AdvanceQuestionClock으로만
// 앞으로 간다). StartRun이 읽는 한도 설정 표는 platform/settings의 저장 선택 표와 같은
// 모양으로만 둔다. 실제 provider를 부르지 않는다.

const CLOCK_START = Date.UTC(2026, 0, 1);

const advanceClockRoute = defineCommand({
  resource: "question-fixture",
  method: "advance-clock",
  name: "AdvanceQuestionClock",
  input: z.strictObject({ ms: z.number().int().min(0) }),
  output: z.strictObject({ now: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

const seedSettingChoiceRoute = defineCommand({
  resource: "setting-choice-fixture",
  method: "seed",
  name: "SeedSettingChoice",
  input: z.strictObject({ key: z.string(), value: z.unknown() }),
  output: z.strictObject({ key: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

export function createLedgerTestRegistration(): LedgerTestRegistration {
  const clock = manualClock(CLOCK_START);
  const presetCommands = createPresetCommands(presetValidateDeps());
  const presetReads = createPresetReads();
  const assignmentCommands = createAssignmentCommands();
  const assignmentReads = createAssignmentReads();
  const runCommands = createRunCommands({ hasUnappliedSteering });
  const runReads = createRunReads();
  // 세션·메시지는 일반 사람 말이 질문의 답이 되지 않는지 보는 데 쓴다(R6). 접수는 제품
  // 조립과 같이 run-loop의 AcceptRun을 같은 Tx에서 부른다.
  const conversationCommands = createConversationCommands({
    acceptRun: (tx, ctx, input, compare) =>
      runCommands.accept.handle(
        tx,
        { ...ctx, actor: "machine" },
        input,
        compare,
      ),
  });
  const conversationReads = createConversationReads();
  const commands = createQuestionCommands();
  const reads = createQuestionReads();
  return {
    clock,
    schemaSteps: [
      ...presetSchemaSteps,
      ...assignmentSchemaSteps,
      ...runSchemaSteps,
      ...conversationSchemaSteps,
      ...questionSchemaSteps,
      {
        id: "questions.test.setting-choices",
        sql:
          "create table setting_choices (layer text not null check (layer = 'common'), key text not null, value json not null, primary key (layer, key))",
      },
    ],
    commands: [
      presetCommands.registerDefault,
      presetCommands.create,
      presetCommands.revise,
      assignmentCommands.createBuiltin,
      assignmentCommands.createAppEngineer,
      assignmentCommands.applyOperator,
      assignmentCommands.changePreset,
      assignmentCommands.pause,
      assignmentCommands.resume,
      assignmentCommands.withdraw,
      runCommands.accept,
      runCommands.start,
      runCommands.checkpoint,
      runCommands.finish,
      runCommands.stop,
      runCommands.confirmNext,
      conversationCommands.open,
      conversationCommands.close,
      conversationCommands.receive,
      commands.create,
      commands.answer,
      commands.defer,
      commands.cancel,
      commands.expire,
    ],
    testCommands: [
      {
        route: advanceClockRoute,
        handle(_tx, _ctx, input) {
          clock.advance((input as { ms: number }).ms);
          return ok({ now: clock.now() });
        },
      },
      {
        route: seedSettingChoiceRoute,
        handle(tx, _ctx, input) {
          const seeded = input as { key: string; value: unknown };
          tx.sql.run(
            "insert into setting_choices (layer, key, value) values ('common', ?, ?) on conflict (layer, key) do update set value = excluded.value",
            [seeded.key, JSON.stringify(seeded.value)],
          );
          return ok({ key: seeded.key });
        },
      },
    ],
    reads: [
      presetReads.read,
      presetReads.list,
      presetReads.instructionAttachments,
      assignmentReads.read,
      assignmentReads.list,
      assignmentReads.outputs,
      runReads.read,
      runReads.list,
      runReads.result,
      conversationReads.session,
      conversationReads.messages,
      reads.read,
      reads.list,
    ],
  };
}
