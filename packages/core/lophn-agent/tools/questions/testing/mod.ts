import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../../../../base/mod.ts";
import {
  QUESTION_BLOB_FIELDS,
  QUESTION_BLOB_OWNER_KIND,
  QUESTION_TEXT_PURPOSE,
} from "../../../../../protocol/lophn-agent/mod.ts";
import {
  type AuthenticatedContext,
  type BlobRefRegistration,
  blobRefRegistrationSchema,
  type PermanentBlobReference,
  type RequestContext,
  type Tx,
} from "../../../../../protocol/platform/mod.ts";

// 질문 ledger 시험이 함께 쓰는 값과 자격. 제품 코드와 mod.ts는 import하지 않는다.
// 실제 provider를 부르지 않는다.

export const OPERATIONS = [
  "CreateBuiltinAssignment",
  "PauseAssignment",
  "WithdrawAssignment",
  "AcceptRun",
  "StartRun",
  "FinishRun",
  "StopRun",
  "OpenSession",
  "CloseSession",
  "ReceiveMessage",
  "ReadSession",
  "ListMessages",
  "CreateQuestionGroup",
  "AnswerQuestionGroup",
  "AnswerQuestionAction",
  "DeferQuestionGroup",
  "CancelQuestionGroup",
  "ExpireQuestionGroup",
  "ReadQuestionGroup",
  "ListQuestionGroups",
  "SeedProject",
  "SeedSettingChoice",
  "AdvanceQuestionClock",
  "SettingsDefinitions",
  "GetSettings",
  "ApplySettings",
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

// 질문 묶음 입력 조각. 선택지는 설명 글을 값으로 싣고(Q38) 질문 ID는 n으로 정한다.
export function optionOf(key: string, action: unknown = null) {
  return {
    key,
    label: `Option ${key}`,
    description: `Description of ${key}`,
    evidence: [],
    adoption: null,
    action,
  };
}

export function questionOf(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: id("qst", n),
    prompt: `Prompt ${n}`,
    reason: `Reason ${n}`,
    options: [],
    recommendation: null,
    ...extra,
  };
}

// 묶음 하나(qgr n)를 만드는 입력. 질문은 questionOf로 만든 것을 순서대로 싣는다.
export function groupOf(
  n: number,
  run: string,
  questions: readonly unknown[],
  extra: Record<string, unknown> = {},
) {
  return {
    id: id("qgr", n),
    run,
    session: null,
    expires_at: null,
    questions,
    ...extra,
  };
}

// 본문 hash 자리표. 시험마다 다른 값이면 충분하다.
export const BODY = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

export function hashOf(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// platform 등록기와 같은 검사(field 정의·준비 주체·purpose)를 줄인 시험용 질문 글 참조
// 등록이다. 참조 행은 실제 blob_refs 표에 들어간다. 준비 참조가 살아 있는지는 platform
// 등록기가 보고 그 경로는 apps/core의 실제 core 시험이 본다.
export function registerQuestionTextRef(
  tx: Tx,
  ctx: RequestContext,
  reference: BlobRefRegistration,
): Result<PermanentBlobReference> {
  if (reference.owner_kind !== QUESTION_BLOB_OWNER_KIND) {
    return err({ code: "forbidden", message: "field is not defined" });
  }
  const parsed = blobRefRegistrationSchema.safeParse(reference);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: "invalid registration" });
  }
  const value = parsed.data;
  if (
    !(Object.values(QUESTION_BLOB_FIELDS) as string[]).includes(value.field)
  ) {
    return err({ code: "forbidden", message: "field is not defined" });
  }
  if (value.source.kind !== "prepared") {
    return err({ code: "forbidden", message: "prepared blob only" });
  }
  const blob = value.source.blob;
  if (
    blob.principal !== ctx.principal || blob.purpose !== QUESTION_TEXT_PURPOSE
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
