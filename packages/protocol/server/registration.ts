import type { z } from "zod";
import type { Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "./identity.ts";
import type { ApprovalAction, ApprovalUse } from "../approvals/approvals.ts";
import type {
  BlobRefRegistration,
  PermanentBlobReference,
} from "../storage/blob.ts";
import type { EventDefinition, EventEnvelopeFor } from "../events/events.ts";
import type { IdPrefix } from "../base/ids.ts";
import type { PortKey } from "../base/ports.ts";
import type { CommandRoute, ReadRoute } from "../base/route.ts";

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
  // 반응 command의 소유 변경과 subscriber 처리 위치를 같은 transaction에 확정한다.
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
  // 사람이 고른 질문 option의 고정 action 한 번을 같은 transaction에서 user 자격으로 적용한다
  // (identity R14). ledger가 질문 정본(port)과 대조해 route·입력·CAS가 고정 action과 같고 그 option을
  // 아직 적용하지 않았을 때만 `handle`을 한 번 부른다. `handle`이 받는 Tx는 event를 actor=user,
  // run=null로 기록하고 이 경로와 `call`은 다시 부르지 못한다. 호출 자격은 machine만이다.
  // 새 transaction·commit은 만들지 않고, 실패하면 바깥 command가 그대로 rollback한다.
  // 선택 member다. 이 경로가 없는 Tx(fixture·fake)는 option 적용을 열지 않는다.
  callChosenOption?<R extends CommandRoute>(
    route: R,
    input: Input<R>,
    compare: Compare<R>,
    evidence: { question: string; option: string },
    handle: (tx: Tx) => Result<Output<R>>,
  ): Result<Output<R>>;
}

export type CommandDefinition<R extends CommandRoute = CommandRoute> = {
  route: R;
  // `tx.call`(approval 적용·question option 적용 등)이 같은 transaction에서 부를 수 있는 command다.
  dispatchable?: boolean;
  // 직접 호출이 없는 dispatch 전용 command다. `dispatchable: true`와 함께만 뜻이 있다. 소유 변경이
  // approval 한 번 사용 같은 상위 경로와 같은 transaction에서만 성립해야 해서(`apply_approved_action`),
  // 어느 자격이든 `/v1/...`로 직접 부르면 등록되지 않은 command와 같은 답을 받는다. `tx.call`은 그대로 부른다.
  dispatchOnly?: boolean;
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

// ledger snapshot 없이 handler가 자기 결과를 내놓는 API read. core가 reader pool 밖에서
// 바로 열고, dispatcher가 기다리므로 handler는 async여도 된다. 경로 해석은 같은
// route registry에서 한다. pool read처럼 동기일 필요가 없다.
export type ApiReadDefinition<R extends ReadRoute = ReadRoute> = {
  route: R;
  handle(
    ctx: RequestContext,
    input: Input<R>,
  ): Result<Output<R>> | Promise<Result<Output<R>>>;
};

// event를 읽는 자격이 그 event를 볼 수 있는지 owner가 정한다. event 구독과 list가 event마다 부른다.
//
// 소비:
// - core registry는 event type마다 owner policy 하나를 고정한다. 같은 type에 policy가 두 개면 기동을 거부한다(safe 오류).
// - policy나 event가 등록되어 있지 않으면 fail-closed다(숨김).
// - hook은 같은 ReadSnapshot, 지금 인증된 RequestContext(ctx.credential_ref로 현재 scope를 다시 검사), 그리고 검사 중인 그 envelope 하나를 받는다.
//   본문뿐 아니라 제목·주소·존재·개수·관계·근거가 새지 않게 subject와 payload가 참조하는 것을 전부 본다.
// - ok(false), 또는 not_found·forbidden은 그 event를 빼는 것이고 batch는 계속 진행한다. scanned_through_seq는 숨긴 event를 지나간 위치다.
// - unavailable·internal, throw, Promise, Result가 아닌 값은 숨김으로 바꾸지 않는다. 전체 batch가 안전하게 실패한다.
// - 그 밖의 오류 코드도 owner denied로 삼키지 않는다. runtime이 안전 batch 오류로 처리한다.
//
// 이 type은 등록 모양과 호출 형태(동기 Result, 읽기 전용 snapshot)만 고정한다.
// 권한·async guard를 강제하지 않으며, 구현 책임은 core 조립과 owner에 있다.
export type EventVisibilityDefinition<
  D extends EventDefinition = EventDefinition,
> = {
  event: D;
  handle(
    snapshot: ReadSnapshot,
    ctx: RequestContext,
    event: EventEnvelopeFor<D>,
  ): Result<boolean>;
};

// id는 concern 안에서 안정된 이름이다. 순번·hash 배정은 core 조립이 맡는다.
export type SchemaStep = { id: string; sql: string };
