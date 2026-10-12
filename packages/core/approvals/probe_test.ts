// Tx.useApproval 시험용 소유 command(platform/approvals#R7, R11). 제품 command가 아니다.
// 소유 변경 event를 하나 내고 그 event를 접수 근거로 approval을 쓴다. 근거 seq와 concern을 입력으로
// 틀어 공통 gate가 거절하는지 본다. 실패하면 이 event까지 같이 되돌아간다.

import { z } from "zod";
import { ok } from "../../base/mod.ts";
import {
  approvalActionSchema,
  type CommandDefinition,
  defineCommand,
  defineEvent,
  idSchema,
} from "../../protocol/platform/mod.ts";

export const approvalProbed = defineEvent("ApprovalProbed", {
  subject: z.string(),
  payload: z.strictObject({}),
});

export const probeUseApproval = defineCommand({
  resource: "approvals",
  method: "probe",
  name: "probe_use_approval",
  input: z.strictObject({
    approval: idSchema("apr"),
    action: approvalActionSchema,
    // 없으면 방금 낸 event를 근거로 쓴다. 있으면 그 seq를 근거로 쓴다(옛 event 시험).
    seq: z.string().nullable(),
    concern: z.string().nullable(),
  }),
  output: z.object({ use: z.unknown() }),
  actors: ["user", "machine"],
  errors: ["conflict"],
});

export const probeUseApprovalCommand: CommandDefinition<
  typeof probeUseApproval
> = {
  route: probeUseApproval,
  handle(tx, _ctx, input) {
    const emitted = tx.emit(approvalProbed, "probe:one", {});
    const seq = input.seq ?? emitted;
    const used = tx.useApproval(input.approval, input.action, {
      approval: input.approval,
      concern: input.concern ?? input.action.concern,
      receipt: { kind: "event", seq },
      accepted_seq: seq,
    });
    if (!used.ok) return used;
    return ok({ use: used.value });
  },
};
