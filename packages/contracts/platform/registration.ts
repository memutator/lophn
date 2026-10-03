import type { z } from "zod";
import type { Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "./identity.ts";
import type { ApprovalAction, ApprovalUse } from "./approvals.ts";
import type { BlobRefRegistration, PermanentBlobReference } from "./blob.ts";
import type { IdPrefix } from "./ids.ts";
import type { PortKey } from "./ports.ts";
import type { CommandRoute, ReadRoute } from "./route.ts";

export type SqlParam = null | number | bigint | string | Uint8Array;
export type SqlParams = readonly SqlParam[];
export type SqlRow = Record<string, SqlParam>;

// StatementSync adapter가 SQL을 prepare하고 positional params를 펼친다.
export interface Sql {
  run(sql: string, params: SqlParams): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
  get(sql: string, params: SqlParams): SqlRow | undefined;
  all(sql: string, params: SqlParams): SqlRow[];
}

export type Input<R extends CommandRoute | ReadRoute> = z.output<R["input"]>;
export type Output<R extends CommandRoute | ReadRoute> = z.output<R["output"]>;
export type Compare<R extends CommandRoute> = z.output<
  Extract<R["compare"], z.ZodType>
>;
export type RequestContext = AuthenticatedContext & { run?: string };

export interface Tx {
  readonly sql: Sql;
  emit<P extends z.ZodType>(
    event: { type: string; payload: P },
    subject: string | null,
    payload: z.input<P>,
  ): string;
  now(): string;
  newId(prefix: IdPrefix): string;
  port<T>(key: PortKey<T>): T;
  // 소유 변경과 같은 transaction에서 준비 주체·purpose 또는 기존 참조 권한을 검사한다.
  registerBlobRef(
    reference: BlobRefRegistration,
  ): Result<PermanentBlobReference>;
  // 반응 command의 소유 변경과 subscriber 처리 위치를 같은 transaction에 확정한다(platform/ledger#R15).
  // 위치가 줄어들면 err이고 handler는 그 결과를 그대로 돌려 전체를 rollback한다.
  advanceSubscriberCursor(
    subscriber: string,
    through_seq: string,
  ): Result<void>;
  // 정확한 action 일치 확인과 approval_uses 기록을 소유 변경과 같은 transaction에서 한다.
  // 일치하지 않거나 이미 사용됐으면 err이고 handler는 그 결과를 그대로 돌려 전체를 rollback한다.
  useApproval(
    approval: string,
    action: ApprovalAction,
    use: ApprovalUse,
  ): Result<ApprovalUse>;
  // registry가 dispatchable을 검사한다. 새 transaction·actor·commit은 만들지 않는다.
  call<R extends CommandRoute>(
    route: R,
    input: Input<R>,
    compare: Compare<R>,
  ): Result<Output<R>>;
}

export type CommandDefinition<R extends CommandRoute = CommandRoute> = {
  route: R;
  dispatchable?: boolean;
  handle(
    tx: Tx,
    ctx: RequestContext,
    input: Input<R>,
    compare: Compare<R>,
  ): Result<Output<R>>;
};

export interface ReadSnapshot {
  readonly sql: Pick<Sql, "get" | "all">;
  readonly as_of_seq: string;
  port<T>(key: PortKey<T>): T;
}

export type ReadDefinition<R extends ReadRoute = ReadRoute> = {
  route: R;
  handle(
    snapshot: ReadSnapshot,
    ctx: RequestContext,
    input: Input<R>,
  ): Result<Output<R>>;
};

// id는 concern 안에서 안정된 이름이다. 순번·hash 배정은 core 조립이 맡는다.
export type SchemaStep = { id: string; sql: string };
