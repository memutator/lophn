import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import {
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  MESSAGE_CONTENT_PURPOSE,
} from "../../../contracts/lophn-agent/mod.ts";
import {
  type AuthenticatedContext,
  type BlobRefRegistration,
  blobRefRegistrationSchema,
  type PermanentBlobReference,
  type RequestContext,
  type Tx,
} from "../../../contracts/platform/mod.ts";

// 세션·메시지 ledger 시험이 함께 쓰는 값과 자격. 제품 코드와 mod.ts는 import하지
// 않는다. 실제 provider를 부르지 않는다.

export const OPERATIONS = [
  "RegisterDefaultPreset",
  "CreateBuiltinAssignment",
  "CreateAppEngineerAssignment",
  "PauseAssignment",
  "ResumeAssignment",
  "WithdrawAssignment",
  "AcceptRun",
  "StartRun",
  "FinishRun",
  "StopRun",
  "ConfirmNextRun",
  "ReadRun",
  "ListRuns",
  "OpenSession",
  "ChangeSessionWorkPlace",
  "CloseSession",
  "ReceiveMessage",
  "ExecuteStoredRequest",
  "RecordMessage",
  "ApplyMessages",
  "AssignMessage",
  "ReadSession",
  "ListSessions",
  "ListMessages",
  "RegisterProvider",
  "StartModelCall",
  "SeedTargetFixture",
  "SeedOperatorFixture",
  "SeedAcceptFailure",
  "SeedUnpreparedBody",
  "StartRequestFixture",
  "CommandResult",
];

export function cred(actor: string): AuthenticatedContext {
  const assignment = actor.startsWith("agent:") ? actor.slice(6) : undefined;
  return {
    actor,
    principal: assignment === undefined ? `${actor}-1` : actor,
    credential_ref: `test:${actor}`,
    scope: {
      operations: OPERATIONS,
      targets: assignment === undefined ? {} : { assignment },
    },
    conditions: assignment === undefined ? {} : { assignment },
  };
}

// agent 자격은 run 하나에 묶여 발급된다(platform/ledger). 시험은 그 run이 생긴 뒤
// 같은 모양의 자격을 harness에 더한다.
export function agentRun(
  assignment: string,
  run: string,
): AuthenticatedContext {
  return {
    actor: `agent:${assignment}`,
    principal: `agent:${assignment}`,
    credential_ref: `test:agent:${assignment}:${run}`,
    scope: { operations: OPERATIONS, targets: { assignment, run } },
    conditions: { assignment, run },
  };
}

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
export function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

export const BODY = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

// 본문 값(MessageContent)과 그 blob의 hash. 요청은 값을 싣고 ledger에는 hash가 남는다.
export function textContent(value: string) {
  return {
    schema_version: 1 as const,
    parts: [{ kind: "text" as const, text: value }],
  };
}

export function bodyHashOf(value: string): string {
  return createHash("sha256").update(canonicalize(textContent(value)), "utf8")
    .digest("hex");
}

export function hashOf(definition: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(definition), "utf8").digest(
    "hex",
  );
}

// platform 등록기와 같은 검사(field 정의·준비 주체·purpose)를 줄인 시험용 본문 참조 등록이다.
// 참조 행은 실제 blob_refs 표에 들어간다. 준비 참조가 살아 있는지는 platform 등록기가 보고
// 그 경로는 apps/core의 실제 core 시험이 본다. unprepared가 참이면 살아 있는 준비가 없는
// 것으로 거절한다.
export function registerMessageBodyRef(
  tx: Tx,
  ctx: RequestContext,
  reference: BlobRefRegistration,
  unprepared: () => boolean = () => false,
): Result<PermanentBlobReference> {
  const parsed = blobRefRegistrationSchema.safeParse(reference);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: "invalid registration" });
  }
  const value = parsed.data;
  if (
    value.owner_kind !== MESSAGE_BODY_OWNER_KIND ||
    value.field !== MESSAGE_BODY_FIELD
  ) {
    return err({ code: "forbidden", message: "field is not defined" });
  }
  if (value.source.kind === "existing") {
    // 이미 다른 owner가 참조한 blob을 가리키는 등록이다. 그 참조 행이 있어야 한다.
    const held = value.source.reference;
    const row = tx.sql.get(
      `select size_bytes from blob_refs
       where owner_kind = ? and owner_key = ? and field = ? and hash = ?`,
      [held.owner_kind, held.owner_key, held.field, held.hash],
    );
    if (row === undefined) {
      return err({ code: "forbidden", message: "no existing blob reference" });
    }
    tx.sql.run(
      `insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes,
         registered_seq) values (?, ?, ?, ?, ?, ?)`,
      [
        value.owner_kind,
        value.owner_key,
        value.field,
        held.hash,
        row["size_bytes"] as number,
        BigInt(value.registered_seq),
      ],
    );
    return ok({
      owner_kind: value.owner_kind,
      owner_key: value.owner_key,
      field: value.field,
      hash: held.hash,
      registered_seq: value.registered_seq,
    });
  }
  const blob = value.source.blob;
  if (
    blob.principal !== ctx.principal ||
    blob.purpose !== MESSAGE_CONTENT_PURPOSE || unprepared()
  ) {
    return err({
      code: "invalid_input",
      message: "no live preparation for this principal and purpose",
    });
  }
  tx.sql.run(
    `insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes,
       registered_seq) values (?, ?, ?, ?, ?, ?)`,
    [
      value.owner_kind,
      value.owner_key,
      value.field,
      blob.hash,
      blob.size_bytes,
      BigInt(value.registered_seq),
    ],
  );
  return ok({
    owner_kind: value.owner_kind,
    owner_key: value.owner_key,
    field: value.field,
    hash: blob.hash,
    registered_seq: value.registered_seq,
  });
}
