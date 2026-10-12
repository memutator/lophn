import {
  err,
  formatSeq,
  internalError,
  ok,
  type Result,
} from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  CommandDefinition,
  Sql,
} from "../../../protocol/server/mod.ts";
import { errorBodySchema } from "../../../protocol/base/mod.ts";
import {
  CONDITION_TARGET_KEYS,
  type CredentialTarget,
} from "../../server/identity/mod.ts";
import { validateOutput } from "./output.ts";

export function isThenable(value: unknown): boolean {
  return typeof value === "object" && value !== null && "then" in value &&
    typeof (value as { then?: unknown }).then === "function";
}

export const ACTOR_KINDS = [
  "user",
  "machine",
  "coding_agent",
  "agent",
  "app",
] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

function isActorKind(value: string): value is ActorKind {
  return (ACTOR_KINDS as readonly string[]).includes(value);
}

export function actorKind(actor: string): ActorKind | undefined {
  const colon = actor.indexOf(":");
  const kind = colon === -1 ? actor : actor.slice(0, colon);
  return isActorKind(kind) ? kind : undefined;
}

export function seqText(value: bigint | null): string | null {
  return value === null ? null : formatSeq(value);
}

export type StoredRow = {
  fingerprint: string;
  result: string;
  first_seq: bigint | null;
  last_seq: bigint | null;
};

export function loadStored(
  sql: Sql,
  principal: string,
  key: string,
): Result<StoredRow | undefined> {
  const row = sql.get(
    `select fingerprint, result, first_seq, last_seq
     from command_results where principal = ? and idempotency_key = ?`,
    [principal, key],
  );
  if (row === undefined) return ok(undefined);
  const digest = row["fingerprint"];
  const result = row["result"];
  const first = row["first_seq"];
  const last = row["last_seq"];
  if (
    typeof digest !== "string" || typeof result !== "string" ||
    (first !== null && typeof first !== "bigint") ||
    (last !== null && typeof last !== "bigint")
  ) {
    return err(internalError());
  }
  return ok({
    fingerprint: digest,
    result,
    first_seq: first,
    last_seq: last,
  });
}

export function replay(row: StoredRow): Result<{
  result: unknown;
  replayed: true;
  first_seq: string | null;
  last_seq: string | null;
  wake: false;
}> {
  let result: unknown;
  try {
    result = JSON.parse(row.result);
  } catch {
    return err(internalError());
  }
  return ok({
    result,
    replayed: true,
    first_seq: seqText(row.first_seq),
    last_seq: seqText(row.last_seq),
    wake: false,
  });
}

// compare의 각 기준을 현재 행과 비교한다. 하나라도 다르면 handler 전에 conflict다(R12).
// 기준 없는 생성은 빈 객체다. 도메인 표가 아직 없으면 그 키는 handler가 거절한다.
export function casAgrees(
  sql: Sql,
  compare: unknown,
  input: unknown,
  checkCursor: (subscriber: string) => Result<void>,
): Result<void> {
  if (
    compare === null || typeof compare !== "object" || Array.isArray(compare)
  ) {
    return err({ code: "invalid_input", message: "compare가 객체가 아니다" });
  }
  const expected = compare as Record<string, unknown>;
  if (!("processed_through_seq" in expected)) return ok(undefined);
  const subscriber = input !== null && typeof input === "object"
    ? (input as Record<string, unknown>)["subscriber"]
    : undefined;
  const seq = expected["processed_through_seq"];
  if (typeof subscriber !== "string" || typeof seq !== "string") {
    return err({ code: "invalid_input", message: "cursor CAS가 없다" });
  }
  // owner 거절과 CAS 불일치를 구별하기 전에 현재 자격으로 cursor read도 검사한다.
  const allowed = checkCursor(subscriber);
  if (!allowed.ok) return allowed;
  const row = sql.get(
    "select processed_through_seq from subscriber_cursors where subscriber = ?",
    [subscriber],
  );
  const stored = row === undefined ? 0n : row["processed_through_seq"];
  if (typeof stored !== "bigint" || stored.toString() !== seq) {
    return err({ code: "conflict", message: "CAS 기준이 현재 기록과 다르다" });
  }
  return ok(undefined);
}

export function headSeq(sql: Sql): Result<bigint> {
  const row = sql.get("select max(seq) as head from events", []);
  const head = row?.["head"];
  if (head === null || head === undefined) return ok(0n);
  if (typeof head !== "bigint") return err(internalError());
  return ok(head);
}

// scope.targets에 있는 고정 조건만 넘긴다. 도메인 대상은 owner handler가 본다.
export function authorityTarget(
  ctx: AuthenticatedContext,
  run: string | undefined,
): CredentialTarget {
  const target: CredentialTarget = {};
  for (const key of CONDITION_TARGET_KEYS) {
    const value = key === "run" && run !== undefined
      ? run
      : ctx.conditions[key];
    if (value !== undefined && Object.hasOwn(ctx.scope.targets, key)) {
      target[key] = value;
    }
  }
  return target;
}

// 저장·송신할 JSON은 같은 leaf의 validateOutput이 정한다(R3, R5). raw 비JSON·-0은 schema strip 전에
// internal이고, schema를 지난 최종 JSON이 다시 schema를 지나 같은 값이어야 한다.
function failureBody(raw: unknown): Result<never> {
  const body = validateOutput(errorBodySchema, { error: raw });
  if (!body.ok) return body;
  return err(body.value.error);
}

// handler가 끝난 뒤 한 번씩만 읽는다. 결과 getter·thenable이 닫힌 Tx를 써도 효과는 없다.
export function handlerResult(
  definition: CommandDefinition,
  handled: unknown,
): Result<unknown> {
  if (isThenable(handled)) {
    // 붙잡힌 continuation의 거절도 관측만 하고 결과로 쓰지 않는다.
    try {
      void (handled as Promise<unknown>).then(() => undefined, () => undefined);
    } catch {
      // then 자체가 던져도 결과는 internal이다.
    }
    return err(internalError());
  }
  if (handled === null || typeof handled !== "object") {
    return err(internalError());
  }
  const result = handled as { ok?: unknown; value?: unknown; error?: unknown };
  const flag = result.ok;
  if (flag === false) return failureBody(result.error);
  if (flag !== true || !("value" in result)) return err(internalError());
  return validateOutput(definition.route.output, result.value);
}

export function eventSpan(
  sql: Sql,
  before: bigint,
): Result<{ first: bigint | null; last: bigint | null }> {
  const row = sql.get(
    "select min(seq) as first_seq, max(seq) as last_seq from events where seq > ?",
    [before],
  );
  const first = row?.["first_seq"];
  const last = row?.["last_seq"];
  if (first === null || first === undefined) {
    return ok({ first: null, last: null });
  }
  if (typeof first !== "bigint" || typeof last !== "bigint") {
    return err(internalError());
  }
  return ok({ first, last });
}

// fingerprint는 transaction 밖에서 이미 계산되어 있다. 여기서는 BEGIN IMMEDIATE부터다.

export function storeCommandResult(
  record: Sql,
  row: {
    principal: string;
    key: string;
    digest: string;
    result: string;
    first: bigint | null;
    last: bigint | null;
    at: string;
  },
): void {
  // handler Tx.sql이 아니다. 변경 행 한도에 넣지 않는다.
  record.run(
    `insert into command_results
      (principal, idempotency_key, fingerprint, result, first_seq, last_seq, at)
     values (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.principal,
      row.key,
      row.digest,
      row.result,
      row.first,
      row.last,
      row.at,
    ],
  );
}
