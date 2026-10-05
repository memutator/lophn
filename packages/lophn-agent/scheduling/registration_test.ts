import { manualClock, ok } from "../../base/mod.ts";
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
import { presetValidateDeps } from "../harness/run-loop/testing/mod.ts";
import {
  createSchedulingCommands,
  createSchedulingReads,
  schedulingSchemaSteps,
} from "./mod.ts";
import {
  APPROVAL_FIXTURE_SQL,
  seedApprovalRoute,
  setClockRoute,
  setRunStateRoute,
  START_MS,
} from "./testing/mod.ts";

// 회차 ledger 테스트 등록. preset·assignment·run 표와 같은 wire에 회차 명령·읽기를
// 붙인다. 시계는 manual clock이고 SetClockFixture가 앞으로 보낸다(wall clock을
// 기다리지 않는다). 승인 표는 platform 소유라 ApplyOperatorAssignment가 읽는 모양만
// fixture로 둔다. 실제 provider를 부르지 않는다.

export function createLedgerTestRegistration(): LedgerTestRegistration {
  const clock = manualClock(START_MS);
  const presetCommands = createPresetCommands(presetValidateDeps());
  const presetReads = createPresetReads();
  const assignmentCommands = createAssignmentCommands();
  const assignmentReads = createAssignmentReads();
  // StartRun이 읽는 공통 설정 표는 platform 소유라 이 ledger에 없다. 한도는 제품 기본값이다.
  const runCommands = createRunCommands({
    runLimits: () =>
      ok({ model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 }),
  });
  const runReads = createRunReads();
  const schedulingCommands = createSchedulingCommands({
    acceptRun: (tx, ctx, input, compare) =>
      runCommands.accept.handle(tx, ctx, input, compare),
  });
  const schedulingReads = createSchedulingReads();
  return {
    clock,
    schemaSteps: [
      ...presetSchemaSteps,
      ...assignmentSchemaSteps,
      ...runSchemaSteps,
      ...schedulingSchemaSteps,
      { id: "scheduling.test.approvals", sql: APPROVAL_FIXTURE_SQL },
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
      schedulingCommands.process,
    ],
    testCommands: [{
      route: setClockRoute,
      handle(_tx, _ctx, input) {
        const request = input as { at: string };
        clock.set(Date.parse(request.at));
        return ok({ at: request.at });
      },
    }, {
      route: setRunStateRoute,
      handle(tx, _ctx, input) {
        const request = input as {
          run: string;
          state: "running" | "waiting_user";
        };
        tx.sql.run(
          "update runs set state = ?, waiting_on = ? where id = ?",
          [
            request.state,
            request.state === "waiting_user"
              ? "qst_01arz3ndektsv4rrffq69g5fav"
              : null,
            request.run,
          ],
        );
        return ok({ run: request.run });
      },
    }, {
      route: seedApprovalRoute,
      handle(tx, _ctx, input) {
        const seeded = input as { id: string; status: string };
        tx.sql.run(
          "insert into approval_requests (id, status) values (?, ?) on conflict (id) do update set status = excluded.status",
          [seeded.id, seeded.status],
        );
        return ok({ id: seeded.id });
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
      schedulingReads.list,
    ],
  };
}
