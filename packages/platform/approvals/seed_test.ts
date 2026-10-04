// 만료 성공 경로의 시드(platform/approvals#R12). 제품 command가 아니다.
// harness 시계는 기동 시각에 고정이라, 기한 경계에 이미 도달한 대기를 직접 심는다.
// 생성 event를 먼저 내서 created_seq의 FK를 만족시킨다.

import { ok } from "../../base/mod.ts";
import { z } from "zod";
import {
  type CommandDefinition,
  defineCommand,
  idSchema,
} from "../../contracts/platform/mod.ts";
import { approvalRequestCreated } from "../../contracts/platform/mod.ts";

export const seedApprovalRequest = defineCommand({
  resource: "approvals",
  method: "seed",
  name: "seed_approval_request",
  input: z.strictObject({
    id: idSchema("apr"),
    expires_at: z.string().nullable(),
  }),
  output: z.object({ created_seq: z.string() }),
  actors: ["machine"],
  errors: [],
});

const HASH = "ab".repeat(32);
const ACTION = {
  concern: "apps/invocations",
  command: "record_started",
  caller: "machine",
  targets: ["app_01h455vb4pex5v6nkc6gd5fdw1"],
  input: {
    kind: "inline",
    value: { release: "rel_01h455vb4pex5v6nkc6gd5fdw1" },
  },
  input_hash: HASH,
  comparison: { release: "rel_01h455vb4pex5v6nkc6gd5fdw1" },
  binding_hash: HASH,
};
const EFFECT = {
  changes_blob: HASH,
  external_blob: null,
  reversible: false,
  reversibility_blob: HASH,
};

export const seedApprovalRequestCommand: CommandDefinition<
  typeof seedApprovalRequest
> = {
  route: seedApprovalRequest,
  handle(tx, _ctx, input) {
    const created = tx.emit(approvalRequestCreated, input.id, {
      binding_hash: HASH,
    });
    tx.sql.run(
      `insert into approval_requests
         (id, requester, run, reason_blob, effect, action, action_binding_hash,
          expires_at, status, closed_reason_blob, created_seq, closed_seq)
       values (?, 'machine', null, ?, ?, ?, ?, ?, 'pending', null, ?, null)`,
      [
        input.id,
        HASH,
        JSON.stringify(EFFECT),
        JSON.stringify(ACTION),
        HASH,
        input.expires_at,
        BigInt(created),
      ],
    );
    return ok({ created_seq: created });
  },
};
