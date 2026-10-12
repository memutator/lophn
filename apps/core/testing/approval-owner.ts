/**
 * approval 적용(platform#T23) 시험의 소유 command 하나. 제품 route가 아니라 시험 전용 team이다.
 * `record_owned_note`는 dispatchable이고 CAS 기준이 현재와 같을 때만 event를 하나 남긴다.
 * 시험은 이 event 수로 "소유 동작이 정확히 몇 번 일어났는지"를 관측한다.
 */
import { z } from "zod";
import { err, ok } from "../../../packages/base/mod.ts";
import {
  type CommandDefinition,
  defineCommand,
  defineEvent,
} from "../../../packages/protocol/platform/mod.ts";

export const ownedNoteRecorded = defineEvent("OwnedNoteRecorded", {
  subject: z.string(),
  payload: z.strictObject({ note: z.string() }),
});

export const recordOwnedNote = defineCommand({
  resource: "owned_notes",
  method: "record",
  name: "record_owned_note",
  input: z.strictObject({ note: z.string().min(1) }),
  output: z.strictObject({ seq: z.string() }),
  compare: z.strictObject({ basis: z.string() }),
  actors: ["user", "machine", "coding_agent"],
  errors: ["conflict"],
});

// 현재 기준은 항상 "current"다. 다른 기준으로 부르면 낡은 전제라 거절한다.
export const CURRENT_BASIS = "current";

const command: CommandDefinition<typeof recordOwnedNote> = {
  route: recordOwnedNote,
  dispatchable: true,
  handle(tx, _ctx, input, compare) {
    if (compare.basis !== CURRENT_BASIS) {
      return err({ code: "conflict", message: "비교 기준이 낡았다" });
    }
    const seq = tx.emit(ownedNoteRecorded, `note:${input.note}`, {
      note: input.note,
    });
    return ok({ seq });
  },
};

export function createCoreRegistration() {
  return { commands: [command] };
}
