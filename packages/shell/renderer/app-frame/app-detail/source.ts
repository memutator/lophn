// app-detail이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만
// 안다. 모양은 contracts(releases·apps.blueprint·grants·invocations·
// problems get-verification·tickets checks)에서 이 화면이 쓰는 field만 옮긴 것이다.
import type { SourceResult } from "../../desktop/lophn-space/source.ts";

export type { SourceResult };

export type VersionStatus =
  | "prepared"
  | "activating"
  | "active"
  | "failed"
  | "superseded";

/** 한 Version(내부 release). 준비·적용·시작 확인·Task 확인은 서로 다른 사실이다. */
export interface VersionRow {
  readonly id: string;
  readonly number: number;
  readonly status: VersionStatus;
  /** 준비한 시각(ISO). */
  readonly createdAt: string;
  /** 이 Version을 만든 Task. 없으면 null이다. */
  readonly ticket: string | null;
  /** 당시 실제 test 결과 참조. */
  readonly tests: readonly string[];
  /** 적용 시도가 실패했을 때 lophn이 남긴 한 줄. */
  readonly failure: string | null;
  readonly dataFormat: number;
}

export interface VersionList {
  /** 지금 쓰는 Version. 아직 없으면 null이다. */
  readonly current: string | null;
  /** 새것부터. */
  readonly versions: readonly VersionRow[];
}

export interface CommandChange {
  readonly command: string;
  readonly kinds: readonly string[];
}

/** 이전 Version과 비교한 바뀐 것. 이름 목록은 자세히 보기 쪽이다. */
export interface Comparison {
  readonly previous: string | null;
  readonly addedPermissions: readonly string[];
  readonly removedPermissions: readonly string[];
  readonly addedCommands: readonly string[];
  readonly removedCommands: readonly string[];
  readonly changedCommands: readonly CommandChange[];
  readonly externalCommands: readonly string[];
  readonly addedAutomations: readonly string[];
  readonly removedAutomations: readonly string[];
  readonly changedAutomations: readonly string[];
  readonly addedScreens: readonly string[];
  readonly removedScreens: readonly string[];
  readonly changedScreens: readonly string[];
  readonly dataFrom: number;
  readonly dataTo: number;
  readonly dataChanges: readonly string[];
  /** 정적 비교는 업무 의미의 동일성을 증명하지 못한다. */
  readonly reviewRequired: boolean;
}

export type TestResultKind = "pass" | "fail" | "inconclusive";

/** 한 Version의 당시 test 결과. */
export interface TestResult {
  readonly id: string;
  readonly result: TestResultKind;
}

/** Task의 acceptance check 결과. */
export interface TaskChecks {
  readonly reported: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly unclear: number;
}

/** 지금 쓰는 Version의 시작 확인. 관측이 없으면 null이다. */
export interface StartCheck {
  readonly release: string | null;
  readonly ready: boolean;
}

export interface BlueprintCommand {
  readonly key: string;
  readonly label: string;
}

export interface BlueprintAutomation {
  readonly key: string;
  readonly label: string;
  readonly command: string;
  readonly when:
    | { readonly kind: "on_start" }
    | { readonly kind: "interval"; readonly intervalMs: number };
  /** external command를 부르는 automation만 사람 승인이 필요하다. */
  readonly external: boolean;
  readonly inputHash: string;
}

export interface BlueprintView {
  readonly release: string;
  readonly commands: readonly BlueprintCommand[];
  readonly automations: readonly BlueprintAutomation[];
  /** 앱 공간 크기(full)로 열리는 화면. */
  readonly fullScreen: string | null;
  readonly connections: readonly {
    readonly app: string;
    readonly commands: readonly string[];
  }[];
}

export type AccessKind =
  | "fs.read"
  | "fs.write"
  | "net.fetch"
  | "net.listen"
  | "secret.use"
  | "document.save"
  | "app.call"
  | "agent.commands"
  | "automation.run";

/** 사람이 허락한 범위 하나. exact는 정확한 원문(경로·host:port·secret 이름·key)이다. */
export interface GrantRow {
  readonly id: string;
  readonly kind: AccessKind;
  readonly active: boolean;
  readonly exact: string;
  /** app.call의 대상 앱. */
  readonly targetApp: string | null;
  readonly commands: readonly string[];
  /** automation.run의 automation key. */
  readonly automation: string | null;
  /** automation.run이 승인한 고정 입력의 hash. 선언이 바뀌면 달라진다. */
  readonly inputHash: string | null;
}

/** 이 Version이 요구하는 범위 하나. */
export interface Requirement {
  readonly kind: AccessKind;
  readonly exact: string;
  readonly reason: string;
  readonly granted: boolean;
}

export interface AccessView {
  readonly grants: readonly GrantRow[];
  readonly requirements: readonly Requirement[];
  /** apps가 정한 조합 경고 key. */
  readonly warnings: readonly string[];
}

export interface RuntimeView {
  readonly state: "preparing" | "stopped" | "running" | "unavailable";
  /** 회수를 위해 프로세스 종료를 기다리는 중. */
  readonly terminationPending: boolean;
}

export type ActivityStatus =
  | "accepted"
  | "running"
  | "succeeded"
  | "failed"
  | "denied"
  | "unknown";

export interface ActivityRow {
  readonly id: string;
  readonly status: ActivityStatus;
  readonly operation:
    | { readonly kind: "command"; readonly command: string }
    | { readonly kind: "start" }
    | {
      readonly kind: "data_change";
      readonly from: number;
      readonly to: number;
    };
  readonly trigger:
    | { readonly kind: "direct" }
    | { readonly kind: "automation"; readonly key: string }
    | { readonly kind: "activation" }
    | { readonly kind: "restart" };
  readonly mode: "live" | "preview" | "test";
  /** 부른 쪽. 앱이면 그 앱 id도 있다. */
  readonly caller: "direct" | "automation" | "app" | "agent" | "system";
  readonly callerApp: string | null;
  /** 끝난 시각, 아직이면 시작 시각, 둘 다 없으면 null. */
  readonly at: string | null;
}

export interface SecretState {
  readonly name: string;
  readonly stored: boolean;
}

export interface StartedPreview {
  readonly nonce: string;
}

/** 사람 결정이 필요한 변경. confirmation window가 정확한 대상을 다시 읽어 보인다. */
export type AppDecision =
  | {
    readonly kind: "use_version";
    readonly app: string;
    readonly release: string;
  }
  | {
    readonly kind: "change_access";
    readonly app: string;
    readonly requirement?: number;
  }
  | {
    readonly kind: "remove_access";
    readonly app: string;
    readonly grant: string;
  }
  | {
    readonly kind: "turn_on_automation";
    readonly app: string;
    readonly automation: string;
  }
  | {
    readonly kind: "connect_apps";
    readonly app: string;
    readonly target?: string;
  };

export interface AppDetailSource {
  versions(app: string): Promise<SourceResult<VersionList>>;
  compare(release: string): Promise<SourceResult<Comparison>>;
  testResults(
    tests: readonly string[],
  ): Promise<SourceResult<readonly TestResult[]>>;
  taskChecks(ticket: string): Promise<SourceResult<TaskChecks>>;
  startCheck(app: string): Promise<SourceResult<StartCheck | null>>;
  blueprint(
    app: string,
    release?: string,
  ): Promise<SourceResult<BlueprintView | null>>;
  access(app: string): Promise<SourceResult<AccessView>>;
  runtime(app: string): Promise<SourceResult<RuntimeView>>;
  secrets(
    names: readonly string[],
  ): Promise<SourceResult<readonly SecretState[]>>;
  activity(app: string): Promise<SourceResult<readonly ActivityRow[]>>;
  /** 다른 앱의 사람이 지은 이름. 없거나 범위 밖이면 null이다. */
  appName(app: string): Promise<string | null>;
  /** 운영과 분리된 preview 프로세스를 시작한다. */
  startPreview(
    app: string,
    release: string,
  ): Promise<SourceResult<StartedPreview>>;
  stopPreview(app: string, preview: StartedPreview): Promise<void>;
  /**
   * 결정 창을 연다. 결정 자체는 그 창에서만 받는다. 창이 열린 뒤 확정되지 않고 끝나면
   * (닫기·취소·만료·교체) onUnconfirmed를 한 번 부른다. 허락은 알리지 않는다.
   */
  decide(
    decision: AppDecision,
    onUnconfirmed?: () => void,
  ): Promise<SourceResult<true>>;
  /** automation 끄기. 확인 창 없이 사람의 회수다. */
  turnOffAutomation(grant: string): Promise<SourceResult<true>>;
}
