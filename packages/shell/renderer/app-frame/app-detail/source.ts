// app-detail이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만
// 안다. 모양은 protocol의 activation(release 기록·선언 비교)·app grant·app invocation·rewind에서
// 이 화면이 쓰는 field만 옮긴 것이다.
import type { SourceResult } from "../../source-result.ts";
import type { DomainActions, DomainView } from "../../workspace/source.ts";
import type { InstructionsFile } from "../../workspace/agents/views.ts";

export type { SourceResult };

export type Effect = "read" | "write" | "external";

// ---- Version ----

export interface ReleaseCard {
  readonly id: string;
  readonly number: number;
  readonly commit: string;
  readonly dataSchema: number;
  /** 활성이 된 시각(ISO). */
  readonly appliedAt: string | null;
  /** 다음 release가 활성이 되어 물러난 시각. 물러나지 않았으면 null이다. */
  readonly replacedAt: string | null;
}

type StepKey = "hold" | "drain" | "stop" | "migrate" | "start";

export interface ActivationStep {
  readonly key: StepKey;
  readonly state: "done" | "now" | "wait";
  /** hold는 붙잡은 호출 수, migrate는 단계 수. 모르면 null이다. */
  readonly count: number | null;
}

/** 줄에 있거나 도는 activation. 단계를 모르면 steps는 모두 wait이다. */
interface Applying {
  readonly id: string;
  readonly number: number;
  readonly phase: "waiting_consent" | "running";
  readonly steps: readonly ActivationStep[];
}

/** 마지막 시도가 실패한 release. 이전 release는 계속 응답한다. */
interface ApplyFailure {
  readonly id: string;
  readonly number: number;
  readonly triedAt: string | null;
  readonly reason: string;
}

export interface VersionView {
  readonly active: ReleaseCard | null;
  readonly applying: Applying | null;
  readonly failed: ApplyFailure | null;
  /** 물러난 release, 새것부터. */
  readonly earlier: readonly ReleaseCard[];
}

export interface LossLine {
  readonly kind: "drop_table" | "drop_column" | "narrow_type";
  readonly table: string;
  readonly column: string | null;
}

/** 대기 목록 카드와 같은 비교. 늘어난 선언과 손실 단계만 있다. */
export interface ReleaseChanges {
  /** 견준 이전 release 번호. 첫 activation이면 null이다. */
  readonly fromNumber: number | null;
  readonly toNumber: number;
  readonly first: boolean;
  readonly addedResources: readonly string[];
  readonly addedTools: readonly {
    readonly app: string;
    readonly appName: string | null;
    readonly tool: string;
  }[];
  readonly lossSteps: readonly {
    readonly from: number;
    readonly to: number;
    readonly loss: readonly LossLine[];
  }[];
}

// ---- Access ----

export type ResourceKind =
  | "file-read"
  | "file-write"
  | "network"
  | "listen"
  | "secret";

export type OAuthState = "none" | "in_progress" | "signed_in" | "failed";

export type OAuthReason =
  | "callback_timeout"
  | "state_mismatch"
  | "exchange_failed"
  | "refresh_rejected"
  | "expired"
  | "store_failed";

/** secret 줄 하나의 상태. 값·token은 없다. */
export interface SecretInfo {
  /** 값이 들어 있는가. OAuth 줄에서는 쓰지 않는다. */
  readonly configured: boolean;
  readonly oauth: null | {
    /** 앱이 선언한 sign-in 곳. 사람이 바꿀 수 없다. */
    readonly authorizeHost: string;
    readonly scopes: readonly string[];
    readonly clientId: string | null;
    readonly clientSecretSet: boolean;
    readonly state: OAuthState;
    /** state가 failed일 때만 있다. */
    readonly reason: OAuthReason | null;
  };
}

/** 앱이 activation 때 받은 바깥 자원 하나. 거두는 단위는 grant다. */
export interface ResourceRow {
  readonly grant: string;
  readonly kind: ResourceKind;
  /** 경로, host:port, secret 이름. 값은 없다. */
  readonly name: string;
  readonly grantedAt: string;
  /** 거두기가 접수돼 정리 중이다. */
  readonly revoking: boolean;
  /** 정리까지 끝나 거둬졌다. */
  readonly revoked: boolean;
  /** kind가 secret일 때만 있다. */
  readonly secret?: SecretInfo;
}

/** 다른 앱의 tool을 부를 수 있는 grant 하나. */
export interface AppToolRow {
  readonly grant: string;
  readonly app: string;
  readonly appName: string | null;
  readonly tools: readonly {
    readonly tool: string;
    /** 그 앱이 선언한 효과. 읽지 못하면 null이다. */
    readonly effect: Effect | null;
  }[];
  readonly grantedAt: string;
  /** 거두기가 접수돼 정리 중이다. */
  readonly revoking: boolean;
  /** 정리까지 끝나 거둬졌다. */
  readonly revoked: boolean;
}

export interface AccessView {
  /** 보호 입력 창에 보일 앱 이름. 읽지 못하면 null이다. */
  readonly appName: string | null;
  readonly resources: readonly ResourceRow[];
  readonly appTools: readonly AppToolRow[];
}

// ---- Activity ----

export type Caller =
  | { readonly kind: "person" }
  | {
      readonly kind: "agent";
      /** agent id(lophn 또는 agt_…). */
      readonly agent: string;
      /** agent 이름. 읽지 못하면 null이다. */
      readonly name: string | null;
      readonly session: string;
      /** session 이름. 읽지 못하면 null이다. */
      readonly title: string | null;
      readonly turn: string;
      readonly toolCall: string;
    }
  | {
      readonly kind: "app";
      readonly app: string;
      readonly appName: string | null;
      readonly releaseNumber: number | null;
    }
  | { readonly kind: "program" }
  | { readonly kind: "flow" }
  | { readonly kind: "start"; readonly reason: "activation" | "restart" };

export type CallState = "done" | "failed" | "waiting" | "running" | "unknown";

export interface ActivityRow {
  readonly id: string;
  /** 끝난 시각, 아직이면 시작 시각, 둘 다 없으면 null(ISO). */
  readonly at: string | null;
  readonly caller: Caller;
  /** tool 이름. 앱 시작과 data 변경은 null이다. */
  readonly tool: string | null;
  readonly kind: "tool" | "start" | "data_change";
  readonly effect: Effect;
  readonly state: CallState;
  /** 되돌림이 이 호출을 되돌렸다. */
  readonly undone: boolean;
  readonly releaseNumber: number | null;
  /** 지금 release보다 앞선 release의 호출이다. */
  readonly earlier: boolean;
  /** 입력 지문. 입력 자체는 남지 않는다. */
  readonly inputHash: string | null;
  /** 결과 한 줄 요약. 없으면 빈 문자열이다. */
  readonly result: string;
}

export interface ActivityView {
  readonly rows: readonly ActivityRow[];
}

export type RewindOutcome = "undone" | "stays" | "cannot";

export interface RewindItem {
  readonly invocation: string;
  readonly at: string;
  readonly tool: string | null;
  readonly kind: ActivityRow["kind"];
  readonly effect: Effect;
  readonly caller: Caller | null;
  readonly outcome: RewindOutcome;
  /** 아직 도는 호출. 끝나기를 기다린다. */
  readonly running: boolean;
}

export interface RewindPlanView {
  readonly from: string;
  /** 최신부터. 고른 호출까지. */
  readonly items: readonly RewindItem[];
  /** 결과 모르는 write가 changeset 없이 닫혀 있어 시작할 수 없다. */
  readonly blocked: { readonly invocation: string } | null;
}

interface RewindProgress {
  /** 끝나기를 기다리는 호출. */
  readonly running: readonly {
    readonly invocation: string;
    readonly tool: string | null;
    readonly at: string;
  }[];
}

export interface RewindResult {
  readonly status: "applied" | "cancelled";
  /** 취소 이유. 성공이면 null이다. */
  readonly reason: string | null;
}

/** 앱 공간이 연 preview. 닫을 때 nonce로 가리킨다. */
interface StartedPreview {
  readonly nonce: string;
}

// ---- Domains ----

/** 앱의 active domain 하나와 그 domain의 tool 수. */
export interface AppDomainRow extends DomainView {
  readonly tools: number;
  /** 다른 그릇이 grant 받아 쓸 수 있는 tool 수. */
  readonly shared: number;
}

export interface AppDetailSource extends DomainActions {
  /** 앱의 active domain들. tool 수는 active release의 선언에서 센다(release가 없으면 0). */
  domains(app: string): Promise<SourceResult<readonly AppDomainRow[]>>;
  /** domain의 DOMAIN.md. 아직 없으면 빈 글과 null hash다(첫 저장이 만든다). */
  readDomainDoc(domain: string): Promise<SourceResult<InstructionsFile>>;
  /** DOMAIN.md를 통째로 쓴다. hash가 디스크와 다르면 code가 conflict이고 파일은 그대로다. */
  writeDomainDoc(
    domain: string,
    text: string,
    hash: string | null,
  ): Promise<SourceResult<InstructionsFile>>;

  versions(app: string): Promise<SourceResult<VersionView>>;
  /** 이 release를 지금 활성 release와 견준 늘어난 선언과 손실 단계. */
  changes(release: string): Promise<SourceResult<ReleaseChanges>>;
  /** 이전 release로 돌아간다. 사람만 한다. migration이 없다. */
  rollback(release: string): Promise<SourceResult<true>>;

  access(app: string): Promise<SourceResult<AccessView>>;
  /** 바깥 자원이나 다른 앱 tool을 거둔다. 요청 접수까지다. 정리는 읽기로 본다. */
  revoke(grant: string): Promise<SourceResult<true>>;
  /** 보호 입력 창으로 secret 값을 넣는다. 값은 이 안을 지나지 않는다. */
  setSecretValue(
    name: string,
    subject: string,
  ): Promise<SourceResult<"stored" | "cancelled">>;
  /** plain secret 값을 지운다. 이름은 앱 사이에 공유되므로 같은 이름을 쓰는 다른 앱의 값도 함께 사라진다. */
  removeSecretValue(name: string): Promise<SourceResult<true>>;
  setOAuthClientId(
    app: string,
    name: string,
    clientId: string,
  ): Promise<SourceResult<true>>;
  /** client secret을 보호 입력 창으로 넣는다. */
  setOAuthClientSecret(
    name: string,
    subject: string,
  ): Promise<SourceResult<"stored" | "cancelled">>;
  /** sign-in 주소를 OS browser로 연다. 끝나기는 기다리지 않고, 화면이 access()를 다시 읽어 본다. */
  signIn(app: string, name: string): Promise<SourceResult<true>>;
  cancelSignIn(app: string, name: string): Promise<SourceResult<true>>;
  /** 앱 OAuth token 셋을 지운다. client id와 client secret은 남는다. */
  signOut(app: string, name: string): Promise<SourceResult<true>>;

  activity(app: string): Promise<SourceResult<ActivityView>>;
  rewindPlan(app: string, from: string): Promise<SourceResult<RewindPlanView>>;
  /** 끝날 때까지 돌아오지 않는다(새 호출 멈춤, 도는 호출 기다림, 되돌림). */
  rewind(app: string, from: string): Promise<SourceResult<RewindResult>>;
  /** rewind가 도는 동안 어느 호출을 기다리는지. */
  rewindProgress(
    app: string,
    from: string,
  ): Promise<SourceResult<RewindProgress>>;

  /** 앱 공간이 열어 둔 preview를 닫는다. */
  stopPreview(app: string, preview: StartedPreview): Promise<void>;
}
