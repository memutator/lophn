// app-detail의 화면 값과 쓰기 통로. 읽기는 reads.ts가 route에서 이 모양으로 옮기고, 쓰기는 이 interface만 보고
// core route 이름은 core-source.ts만 안다. 모양은 protocol의 activation(release 기록·선언 비교)·app grant·
// app invocation·rewind에서 이 화면이 쓰는 field만 옮긴 것이다.

import type { NoticeKind } from "../../../../protocol/apps/notice.ts";
import type { IconFile } from "../../parts/icon-upload/icon-reader.ts";
import type { SourceResult } from "../../source-result.ts";

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

/** 앱이 고정한 SDK 하나. required는 lophn이 더 돌리지 않는 옛 판, available은 옛 판이지만 돈다. */
export interface SdkRow {
  readonly sdk: string;
  readonly pinned: string;
  readonly current: string;
  readonly level: "required" | "available" | "current";
}

export interface VersionView {
  readonly active: ReleaseCard | null;
  /** 켜진 release가 고정한 SDK 판. 읽지 못하면 비운다. */
  readonly sdks: readonly SdkRow[];
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
  | "secret"
  | "notify"
  | "phone";

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
  /** 값이 들어 있는가. OAuth 줄에서는 쓰지 않는다. 다른 컴퓨터가 secret 상태를 내주지 않으면(`secrets/status`는 사람의 route다) null이다. */
  readonly configured: boolean | null;
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
  /** 경로, host:port, secret 이름, 폰 기능의 문장. 값은 없다. */
  readonly name: string;
  readonly grantedAt: string;
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

/** 다른 컴퓨터 안에서 시킨 쪽. agent의 name은 그 컴퓨터가 쓴 값이다. app은 이 컴퓨터에 있으면 이름이다. */
export type RemoteRequester =
  | { readonly kind: "screen" | "terminal" }
  | { readonly kind: "agent"; readonly name: string }
  | {
      readonly kind: "app";
      readonly app: string;
      readonly name: string | null;
    };

export type Caller =
  | { readonly kind: "person" }
  | {
      readonly kind: "agent";
      /** agent id(lophn 또는 agt_…). */
      readonly agent: string;
      /** agent 이름. 읽지 못하면 null이다. */
      readonly name: string | null;
      readonly session: string | null;
      /** session 이름. 읽지 못하면 null이다. */
      readonly title: string | null;
      readonly turn: string | null;
      readonly toolCall: string | null;
    }
  | {
      readonly kind: "app";
      readonly app: string;
      readonly appName: string | null;
      readonly releaseNumber: number | null;
    }
  | { readonly kind: "program" }
  | { readonly kind: "flow" }
  /**
   * 다른 컴퓨터가 불렀다. machine은 이 컴퓨터의 명단에서 찾은 그 컴퓨터 이름이고 없으면 짧은 id다. requester는 그 컴퓨터가
   * 알린 값이라 표시만 한다.
   */
  | {
      readonly kind: "remote";
      readonly machine: string;
      readonly requester: RemoteRequester;
    }
  | {
      readonly kind: "event";
      /** 다른 컴퓨터에서 온 event면 그 컴퓨터 이름(없으면 짧은 id). 이 컴퓨터에서 난 것이면 null이다. */
      readonly machine: string | null;
      /** 발행한 앱의 이름. core(`lophn`)가 낸 것이면 `lophn`, 못 읽으면 null. */
      readonly publisherName: string | null;
      readonly event: string;
    }
  | { readonly kind: "start"; readonly reason: "activation" | "restart" };

export type CallState = "done" | "failed" | "waiting" | "running" | "unknown";

export interface ActivityRow {
  readonly id: string;
  /** 끝난 시각, 아직이면 시작 시각, 둘 다 없으면 null(ISO). */
  readonly at: string | null;
  readonly caller: Caller;
  /** operation이나 command의 이름. 앱 시작과 data 변경은 null이다. */
  readonly tool: string | null;
  readonly kind: "call" | "start" | "data_change";
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
  /** 이 컴퓨터가 다른 컴퓨터의 앱 command를 부른 기록. changeset과 rewind가 없다. */
  readonly remoteTarget?: {
    readonly machine: string;
    readonly app: string;
    readonly appName: string | null;
  };
}

/** 그 앱의 영구 기록 한 줄(release 결과, 앱 멈춤, 앱이 남긴 영구 알림). */
export interface AppNoticeRow {
  readonly id: string;
  readonly kind: NoticeKind;
  readonly title: string;
  readonly body: string;
  readonly at: string;
  readonly unread: boolean;
}

export interface ActivityView {
  readonly rows: readonly ActivityRow[];
  /** 그 앱의 영구 기록, 새것부터. 읽지 못해도 호출 기록은 보이게 비운다. */
  readonly notices: readonly AppNoticeRow[];
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

export interface RewindResult {
  readonly status: "applied" | "cancelled";
  /** 취소 이유. 성공이면 null이다. */
  readonly reason: string | null;
}

/** 실행 상태. halted는 crash loop로 자동 재시작이 멈춘 것이다. preparing은 채택한 release가 아직 없다. */
export type RunState =
  | "running"
  | "unavailable"
  | "stopped"
  | "halted"
  | "preparing";

export interface RunView {
  /** 사람이 켠 실행 허용(run_enabled). halted여도 true다. */
  readonly enabled: boolean;
  readonly state: RunState;
}

// ---- Machines ----

/** 이 기계가 다른 기계의 새 release를 따라가는 상태(core follow). */
export type FollowStep =
  | "current"
  | "installing"
  | "activating"
  | "waiting_consent"
  | "declined"
  | "lophn_update"
  | "install_failed"
  | "activation_failed"
  | "diverged";

/** 다른 release라 이 기계가 적용하지 않고 둔 그 기계의 변경. */
export interface HeldLine {
  readonly changes: number;
  /** 한도에 닿아 나머지는 폴더에 남아 있다. */
  readonly full: boolean;
  /** newer: 이 기계가 그 release로 올라가면 적용된다. older: 그 기계가 올라온 뒤 온다. diverged: 앱 agent가 합친 release가 나와야 온다. */
  readonly why: "newer_release" | "older_release" | "diverged";
}

export interface MachineLine {
  readonly machine: string;
  readonly name: string;
  readonly thisMachine: boolean;
  /** 그 기계의 활성 release: 이 기계에 있으면 r<n>, 아니면 commit 앞 7자. 모르면 null. */
  readonly release: string | null;
  readonly lophnVersion: string | null;
  readonly exchange: "ok" | "update_this" | "update_peer";
  readonly held: readonly HeldLine[];
}

export interface MachinesView {
  readonly follow: {
    readonly step: FollowStep;
    /** 따라가려는 release(r<n>이나 commit 앞 7자). 모르면 null. */
    readonly target: string | null;
    readonly reason: string | null;
  };
  /** 이 기계가 첫 줄이다. */
  readonly machines: readonly MachineLine[];
}

export type UnresolvedSubscriptionReason = "not_found" | "ambiguous" | "self";

/** 활성 release의 원격 event 구독 가운데 지금 명단에서 컴퓨터 이름을 풀지 못한 것. */
export interface UnresolvedSubscription {
  readonly source: string;
  readonly event: string;
  readonly machine: string;
  readonly reason: UnresolvedSubscriptionReason;
}

export interface AppDetailSource {
  /** 다른 컴퓨터의 source다. 읽기만 하고 아래 쓰기는 모두 unavailable이며 화면은 쓰는 단추를 그리지 않는다. */
  readonly readOnly?: true;
  /** 사람이 지은 앱 이름을 바꾼다. 비면 `invalid_input`이다. */
  rename(app: string, name: string): Promise<SourceResult<true>>;
  /** 앱을 보관한다(실행도 끈다). Home의 Workspaces panel에서 꺼낸다. */
  archive(app: string): Promise<SourceResult<true>>;
  /** 실행 허용을 켜거나 끈다. 끄면 앱 process가 멈추고, 보관된 앱은 켤 수 없다(conflict). */
  setRun(app: string, enabled: boolean): Promise<SourceResult<true>>;
  /** 올린 icon을 정한다. null이면 올린 것을 지워 선언한 icon(없으면 첫 글자 표식)으로 돌아간다. */
  setIcon(app: string, icon: IconFile | null): Promise<SourceResult<true>>;

  /** OS 선택기로 앱 source 밖 폴더(agent의 file 범위에 들어간다)를 하나 더한다. 선택기를 닫으면 아무 일 없다. */
  addFolder(app: string): Promise<SourceResult<true>>;
  /** 이은 폴더 하나를 뺀다. 디스크의 폴더는 그대로다. */
  removeFolder(app: string, path: string): Promise<SourceResult<true>>;

  /** 이전 release로 돌아간다. 사람만 한다. migration이 없다. */
  rollback(release: string): Promise<SourceResult<true>>;

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
  /** sign-in 주소를 OS browser로 연다. 끝나기는 기다리지 않고, 끝나면 secrets 변경으로 화면이 다시 읽는다. */
  signIn(app: string, name: string): Promise<SourceResult<true>>;
  cancelSignIn(app: string, name: string): Promise<SourceResult<true>>;
  /** 앱 OAuth token 셋을 지운다. client id와 client secret은 남는다. */
  signOut(app: string, name: string): Promise<SourceResult<true>>;

  /** 끝날 때까지 돌아오지 않는다(새 호출 멈춤, 도는 호출 기다림, 되돌림). */
  rewind(app: string, from: string): Promise<SourceResult<RewindResult>>;
}
