import { z } from "zod";
import { ok } from "../../../base/mod.ts";
import { ACTOR_KINDS, defineCommand } from "../../../protocol/platform/mod.ts";
import type { LedgerTestRegistration } from "../../../../apps/core/testing/ledger.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
  createAssignmentReads,
} from "../assignments/mod.ts";
import { createRunCommands, createRunReads, runSchemaSteps } from "./mod.ts";

// run ledger 테스트 등록. assignment 표와 같은 wire에 run 명령·읽기를
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

// platform/settings의 저장 선택 표와 같은 모양이다. 이 leaf는 platform을 import하지 않고
// StartRun이 읽는 표만 같은 SQL로 둔다. 사람의 apply를 흉내 내는 fixture command다.
export const seedSettingChoiceRoute = defineCommand({
  resource: "setting-choice-fixture",
  method: "seed",
  name: "SeedSettingChoice",
  input: z.strictObject({ key: z.string(), value: z.unknown() }),
  output: z.strictObject({ key: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

// assignment가 멈추거나 거둬진 상태를 심는다. 멈춤을 낳는 자리 보관 event는 이 leaf의 관심이 아니고
// run-loop는 assignment의 지금 상태만 읽으므로 표를 바로 고친다.
export const seedAssignmentStateRoute = defineCommand({
  resource: "assignment-state-fixture",
  method: "seed",
  name: "SeedAssignmentState",
  input: z.strictObject({
    assignment: z.string(),
    state: z.enum(["paused", "withdrawn"]),
  }),
  output: z.strictObject({ assignment: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

export function createLedgerTestRegistration(): LedgerTestRegistration {
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
      ...assignmentSchemaSteps,
      ...runSchemaSteps,
      {
        id: "run-loop.test.setting-choices",
        sql:
          "create table setting_choices (layer text not null check (layer = 'common'), key text not null, value json not null, primary key (layer, key))",
      },
      {
        id: "run-loop.test.steering",
        sql:
          "create table steering_inputs (run text not null, applied integer not null)",
      },
    ],
    commands: [
      assignmentCommands.createBuiltin,
      assignmentCommands.createAppEngineer,
      assignmentCommands.createOperator,
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
      route: seedAssignmentStateRoute,
      handle(tx, _ctx, input) {
        const seeded = input as { assignment: string; state: string };
        const paused = seeded.state === "paused";
        tx.sql.run(
          `update assignments set state = ?, revision = revision + 1,
             pause_detail = ?, pause_target = ? where id = ?`,
          [
            seeded.state,
            paused ? "The place was archived." : null,
            paused ? "prj_01arz3ndektsv4rrffq69g5fav" : null,
            seeded.assignment,
          ],
        );
        return ok({ assignment: seeded.assignment });
      },
    }, {
      route: seedSettingChoiceRoute,
      handle(tx, _ctx, input) {
        const seeded = input as { key: string; value: unknown };
        tx.sql.run(
          "insert into setting_choices (layer, key, value) values ('common', ?, ?) on conflict (layer, key) do update set value = excluded.value",
          [seeded.key, JSON.stringify(seeded.value)],
        );
        return ok({ key: seeded.key });
      },
    }, {
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
      assignmentReads.read,
      assignmentReads.list,
      runReads.read,
      runReads.list,
      runReads.result,
    ],
  };
}
