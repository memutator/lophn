// core 안에서만 쓰는 machine route. 사람이 부르는 route(대기 목록, 결정)는 protocol이 정한다.
import { z } from "zod";
import { withReadCommon } from "../../protocol/base/envelope.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import { defineCommand, defineRead } from "../../protocol/base/route.ts";
import {
  applyResultSchema,
  intentSchema,
  pendingApprovalSchema,
} from "../../protocol/approvals/mod.ts";

// Gate가 ask를 낸 보류 intent를 표에 쓴다. 같은 intent가 이미 pending이면 그것을 돌려준다.
export const approvalsCreatePending = defineCommand({
  resource: "approvals",
  method: "create_pending",
  name: "CreatePendingApproval",
  input: z.strictObject({ intent: intentSchema }),
  // created가 false면 이미 기다리던 request다.
  output: z.object({ request: pendingApprovalSchema, created: z.boolean() }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 더 새 release의 activation이 시작되면 이전 release의 pending activation request를 cancelled로 둔다.
export const approvalsCancelPendingFor = defineCommand({
  resource: "approvals",
  method: "cancel_pending_for",
  name: "CancelPendingApprovals",
  input: z.strictObject({
    app: idSchema("app"),
    release: idSchema("rel").optional(),
  }),
  output: z.object({ cancelled: z.number().int().min(0) }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 허락된 request의 적용 결과를 쓰고 ApprovalDecided를 낸다.
export const approvalsRecordApplied = defineCommand({
  resource: "approvals",
  method: "record_applied",
  name: "RecordApprovalApplied",
  input: z.strictObject({
    request: idSchema("apr"),
    applied: applyResultSchema,
  }),
  output: z.object({ request: pendingApprovalSchema }),
  actors: ["machine"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

// 허락됐는데 적용 결과가 아직 없는 request. 꺼졌다 켜질 때 다시 적용한다.
export const approvalsUnapplied = defineRead({
  resource: "approvals",
  method: "unapplied",
  name: "ListUnappliedApprovals",
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({ requests: z.array(pendingApprovalSchema) }),
  ),
  actors: ["machine"],
  errors: ["forbidden", "unavailable"],
});

// request 하나. 없는 id는 null이다.
export const approvalsRequest = defineRead({
  resource: "approvals",
  method: "request",
  name: "GetApprovalRequest",
  input: z.strictObject({ request: idSchema("apr") }),
  output: withReadCommon(
    z.object({ request: pendingApprovalSchema.nullable() }),
  ),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

export const APPROVAL_INTERNAL_COMMANDS = [
  approvalsCreatePending,
  approvalsCancelPendingFor,
  approvalsRecordApplied,
] as const;
