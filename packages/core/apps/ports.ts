import type { z } from "zod";
import type { LophnError, Result } from "../../base/mod.ts";
import type { Actor } from "../../protocol/base/actor.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { AgentRef, Place } from "../../protocol/lophn-agent/places.ts";
import type { At } from "../../protocol/base/values.ts";
import type {
  AppApiTarget,
  AppInvocation,
  appInvocationsInputSchema,
  ProcessApplyRequest,
  ProcessApplyResponse,
  ProcessCallRequest,
  ProcessCallResponse,
  Rewind,
  RewindPlan,
  ToolCallInput,
  ToolCallOutput,
} from "../../protocol/apps/calls/mod.ts";

// app-calls module들이 서로 기대는 port. 구현은 각 task가, 가짜 구현은 쓰는 쪽 시험이 만든다.
export type InvocationFilter = z.infer<typeof appInvocationsInputSchema>;

/**
 * 구현: app-calls-path. 쓰는 곳: `app.call_tool` route handler(app-calls-assembly), 앱 process broker 서비스.
 * `auth`는 route가 확인한 credential이다. 부른 쪽 확인, Gate, invocation 기록,
 * write 줄 세우기, 앱 process 전달, 결과를 모두 이 호출 하나가 한다.
 *
 * Gate는 port를 새로 만들지 않고 `core/approvals/ports.ts`의 `Approvals`를 직접 쓴다. 순서:
 * - actor가 agent·app이면 intent `{kind: "app_api", actor, target: {app, api}, effect, input, origin}`을
 *   만들어 `judge(intent)`를 부른다. 사람 화면(`person`)은 Gate를 거치지 않는다.
 * - `deny`면 `denied(gate_blocked)`.
 * - `ask`면 `openTurnRequest` -> `waitTurnDecision`. reject는 `denied(rejected)`, cancelled는 `denied(cancelled)`.
 * - 허락이면 앱 process에 보내기 직전에 `consumeTurnAllow`.
 */
export interface AppApiCallPath {
  call(
    input: ToolCallInput,
    auth: { actor: "user" | "agent" | "app"; app?: Id<"app"> },
  ): Promise<Result<ToolCallOutput>>;
}

/**
 * 구현: lead 조립(places-sessions의 session 읽기). 쓰는 곳: app-calls-path.
 * 그 tool call이 지금 도는 turn의 것인지 확인하고 그 agent가 놓인 곳을 준다. 아니면 null.
 */
export interface CallerDirectory {
  agentToolCall(
    session: Id<"ses">,
    turn: Id<"trn">,
    tool_call: Id<"tcl">,
  ): Result<
    { agent: AgentRef; place: Place | null } | null
  >;
}

/**
 * 구현: app-calls-assembly(`core/apps/blueprint` 읽기). 쓰는 곳: app-calls-path.
 * 활성 release(release가 null일 때) 또는 고정 release의 blueprint 선언. 없는 app-api는 null.
 */
export interface AppApiLookup {
  find(
    app: Id<"app">,
    release: Id<"rel"> | null,
    api: string,
  ): Result<
    {
      release: Id<"rel">;
      effect: "read" | "write" | "external";
    } | null
  >;
}

/**
 * 구현: app-calls-invocations.
 * 쓰는 곳: app-calls-path, app-calls-rewind, releases-problems의 activation, places-sessions의 session rewind.
 */
export interface InvocationLedger {
  /** write·external·앱 시작은 시작을 미리 남긴다. */
  begin(
    input: Omit<
      AppInvocation,
      | "status"
      | "finished_at"
      | "changeset"
      | "reverted_by"
      | "summary"
      | "detail_hash"
    >,
  ): Result<AppInvocation>;
  /** changeset 저장(blob)은 구현이 한다. */
  finish(
    id: Id<"inv">,
    result: {
      status: "succeeded" | "failed" | "unknown";
      finished_at: At;
      summary: AppInvocation["summary"];
      detail_hash: string | null;
      changeset: Uint8Array | null;
    },
  ): Promise<Result<AppInvocation>>;
  /** 시작을 미리 남기지 않는 읽기가 실패했을 때와 `denied`를 끝에서 한 번에 남긴다. */
  recordOnce(input: AppInvocation): Promise<Result<AppInvocation>>;
  get(id: Id<"inv">): Result<AppInvocation | null>;
  list(filter: InvocationFilter): Result<readonly AppInvocation[]>;
  changesetOf(id: Id<"inv">): Promise<Result<Uint8Array | null>>;
  /** 되돌림 표시. 기록은 지우지 않는다. */
  markReverted(
    ids: readonly Id<"inv">[],
    rewind: Id<"rwd">,
  ): Result<void>;
  /** activation이 끝난 뒤 이전 release의 changeset을 지운다. 지운 개수를 준다. */
  pruneChangesets(
    app: Id<"app">,
    keepRelease: Id<"rel">,
  ): Promise<Result<number>>;
  /** core 재시작 점검. 끝나지 않은 호출을 결과 모름으로 닫는 것은 구현이 한다. */
  unfinished(): Result<readonly AppInvocation[]>;
}

/**
 * 구현: app-calls-supervisor의 `supervisor-link`. 쓰는 곳: app-calls-path, app-calls-rewind.
 * `call`은 "앱에 보내기 전에 실패했는지"와 "보냈는데 응답을 받지 못했는지(결과 모름, `response: null`)"를
 * 구별해야 해서 `Result`를 쓰지 않는다. 앱이 멈췄거나 연결이 없으면 `sent: false`다.
 */
export interface AppProcessLink {
  call(
    target: AppApiTarget,
    request: ProcessCallRequest,
  ): Promise<
    | { sent: false; error: LophnError }
    | { sent: true; response: ProcessCallResponse | null }
  >;
  apply(
    app: Id<"app">,
    request: ProcessApplyRequest,
  ): Promise<Result<ProcessApplyResponse>>;
}

/**
 * 구현: app-calls-path. 쓰는 곳: app-calls-rewind, releases-problems의 activation, app-calls-supervisor의 정지.
 * 닫힌 동안 온 호출은 실패시키지 않고 붙잡아 둔다.
 */
export interface AppIntake {
  /** 새 호출 접수를 닫는다. */
  close(app: Id<"app">, reason: "rewind" | "activation"): void;
  /** 도는 호출이 끝나기를 기다린다. */
  whenIdle(
    app: Id<"app">,
    graceMs: number,
  ): Promise<
    { idle: true } | { idle: false; running: readonly Id<"inv">[] }
  >;
  /** 끝나지 않은 호출을 결과 모름으로 닫아 부른 쪽에 돌려준다(유예 뒤 강제 정지 때). */
  abandon(app: Id<"app">): Promise<void>;
  /** 접수를 다시 열고 붙잡은 호출을 넘긴다. 넘길 때 대상 release는 그때의 활성 release다. */
  open(app: Id<"app">): void;
  /** 닫힌 동안 붙잡아 둔 호출 수. */
  heldCount(app: Id<"app">): number;
}

/**
 * 구현: app-calls-rewind.
 * 쓰는 곳: `app.rewind_plan`·`app.rewind` handler(app-calls-assembly), places-sessions의 session rewind.
 */
export interface AppRewind {
  plan(app: Id<"app">, from: Id<"inv">): Result<RewindPlan>;
  apply(
    app: Id<"app">,
    from: Id<"inv">,
    by: Actor,
  ): Promise<Result<Rewind>>;
}

/** 구현: lead 조립(releases의 bundle 사본과 preview 영역). 쓰는 곳: app-calls-screens. */
export interface BundleLocator {
  /** 그 target의 UI bundle 사본 폴더 경로. 없으면 `not_found`. */
  dir(target: AppApiTarget): Result<string>;
}

/**
 * 구현: lead 조립(남지 않는 event `AppViewChanged`를 내는 쪽). 쓰는 곳: app-calls-rewind.
 * event 이름과 payload는 `protocol/events`가 정한다. 이 port는 그 event를 내는 한 줄이다.
 */
export interface AppViewSignal {
  changed(app: Id<"app">, reason: "rewind"): void;
}
