import { z } from "zod";
import { ok } from "../../../base/mod.ts";
import { ACTOR_KINDS, defineCommand } from "../../../contracts/platform/mod.ts";
import type { LedgerTestRegistration } from "../../../../apps/core/testing/ledger.ts";
import {
  createPresetCommands,
  createPresetReads,
  presetSchemaSteps,
} from "../../presets/mod.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
  createAssignmentReads,
} from "../../assignments/mod.ts";
import { presetValidateDeps } from "./testing/mod.ts";
import { createRunCommands, createRunReads, runSchemaSteps } from "./mod.ts";

// run ledger 테스트 등록. preset·assignment 표와 같은 wire에 run 명령·읽기를
// 붙인다. 미반영 steering을 담는 입력 표는 lophn-agent/conversation 소유이므로
// 이 fixture가 같은 모양의 자리(steering_inputs)를 따로 둬서 종료 경계 규칙을
// 실제 SQL로 확인한다. 실제 provider를 부르지 않는다.

export const seedSteeringRoute = defineCommand({
  resource: "steering-fixture",
  method: "seed",
  name: "SeedSteeringFixture",
  input: z.strictObject({ run: z.string(), applied: z.boolean() }),
  output: z.strictObject({ run: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

export function createLedgerTestRegistration(): LedgerTestRegistration {
  const presetCommands = createPresetCommands(presetValidateDeps());
  const presetReads = createPresetReads();
  const assignmentCommands = createAssignmentCommands();
  const assignmentReads = createAssignmentReads();
  const runCommands = createRunCommands({
    hasUnappliedSteering: (tx, run) =>
      tx.sql.get(
        "select run from steering_inputs where run = ? and applied = 0",
        [run],
      ) !== undefined,
  });
  const runReads = createRunReads();
  return {
    schemaSteps: [
      ...presetSchemaSteps,
      ...assignmentSchemaSteps,
      ...runSchemaSteps,
      {
        id: "run-loop.test.steering",
        sql:
          "create table steering_inputs (run text not null, applied integer not null)",
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
    ],
    testCommands: [{
      route: seedSteeringRoute,
      handle(tx, _ctx, input) {
        const seeded = input as { run: string; applied: boolean };
        tx.sql.run("insert into steering_inputs (run, applied) values (?, ?)", [
          seeded.run,
          seeded.applied ? 1 : 0,
        ]);
        return ok({ run: seeded.run });
      },
    }],
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
    ],
  };
}
