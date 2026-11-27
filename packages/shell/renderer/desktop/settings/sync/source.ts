// Settings › My computers의 동기화·전송·staged 설정 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만 안다.
import type {
  SettingsExportKind,
  StagedSettingsBatch,
} from "../../../../../protocol/folder/settings-export.ts";
import type { TransferRecord } from "../../../../../protocol/folder/transfers.ts";
import type { AvailableApp, TakeInOutcome } from "../../../apps/take-in.ts";
import type { SourceResult } from "../source.ts";

export type {
  AvailableApp,
  SettingsExportKind,
  SourceResult,
  StagedSettingsBatch,
  TakeInOutcome,
  TransferRecord,
};

export type AppSyncPolicy = "computers" | "local" | "mixed";
export type AppSyncOverride = "default" | "computers" | "local";

/** 이름 붙인 폴더. `state`는 core가 그 폴더를 본 결과이고, 모르면 null이다. */
export interface SyncFolder {
  readonly name: string;
  readonly path: string;
  readonly state: "ok" | "missing" | "not_writable" | null;
}

/** 폴더 설정(`folder.destinations`, `folder.shared`)과 `remote.enabled`. */
export interface SyncFolders {
  /** "내 컴퓨터들이 같이 보는 폴더"의 path. 정하지 않았으면 null이다. */
  readonly shared: string | null;
  readonly named: readonly SyncFolder[];
  readonly remoteEnabled: boolean;
}

/** 컴퓨터 하나에서 마지막으로 받은 file이 어느 길로 왔나. 이 core가 뜬 뒤 받은 것만 안다. */
export interface SyncReceived {
  readonly machine: string;
  readonly receivedAt: string | null;
  readonly via: "link" | "phone" | "folder" | null;
}

/** 앱 data의 destination들, 현재 sync policy·override, held/away 상태, 마지막으로 읽은 때(ISO). */
export interface SyncAppRow {
  readonly app: string;
  readonly name: string;
  readonly destinations: readonly string[];
  readonly readAt: string | null;
  readonly syncPolicy?: AppSyncPolicy;
  readonly syncOverride?: AppSyncOverride;
  readonly heldCount?: number;
  readonly awaySince?: string | null;
}

export interface SyncStatus {
  /** 쓸 수 있는 같이 보는 폴더의 상태. 정하지 않았거나 쓰지 못하는 값이면 null이다. */
  readonly shared: Pick<SyncFolder, "path" | "state"> | null;
  readonly received: readonly SyncReceived[];
  readonly apps: readonly SyncAppRow[];
  /** 명단에 같은 machine id를 단 컴퓨터 항목이 둘 이상인 기계. 받는 쪽이 manifest 서명을 믿지 않아 carry가 멈춘다. */
  readonly duplicateMachines: readonly string[];
  /** 다른 컴퓨터가 내놓았고 이 컴퓨터에 아직 없는 앱. 읽지 못하면 빈 목록이다. */
  readonly available: readonly AvailableApp[];
  /** `machine/environment`가 보고한 hub 기계 id 목록. */
  readonly hubMachines?: readonly string[];
  /** `machine/environment`가 보고한 기계별 lophn 판(이 컴퓨터 포함). */
  readonly machineVersions?: Readonly<Record<string, string>>;
}

export interface StagedSettingsApplyOutcome {
  readonly applied: readonly {
    readonly kind: SettingsExportKind;
    readonly id: string;
    readonly status:
      | "applied"
      | "skipped_conflict"
      | "requires_person_confirmation";
  }[];
  readonly requiresPermissionConfirmation: boolean;
}

/** `permission_rules`나 `locked_fields`가 들어 있는 배치는 사람의 명시적 확인이 필요하다. */
export function batchRequiresPermissionConfirmation(
  batch: StagedSettingsBatch,
): boolean {
  return batch.items.some(
    (item) =>
      item.kind === "permission_rules" ||
      (item.locked_fields !== undefined && item.locked_fields.length > 0),
  );
}

/** 저장 결과. rejected의 message는 core가 거절한 까닭(영어)이고 없을 수 있다. */
export type SaveOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "rejected" | "failed";
      readonly message: string | null;
    };

export interface SyncSettingsSource {
  folders(): Promise<SourceResult<SyncFolders>>;
  status(): Promise<SourceResult<SyncStatus>>;
  /** 이름 붙인 폴더를 더하거나 고친다. `was`는 이름을 바꾸는 폴더의 옛 이름이고 새로 더하면 null이다. */
  saveNamed(input: {
    name: string;
    path: string;
    was: string | null;
  }): Promise<SaveOutcome>;
  removeNamed(name: string): Promise<SaveOutcome>;
  /** 같이 보는 폴더를 정하거나(path) 그만둔다(null). */
  setShared(path: string | null): Promise<SaveOutcome>;
  /** 앱별 `sync.app_policies` 덮어쓰기. */
  setAppSyncPolicy(app: string, policy: AppSyncOverride): Promise<SaveOutcome>;
  /** 앱의 held sync 변경을 적용하거나 버린다. */
  resolveAppHeld(
    app: string,
    action: "apply" | "discard",
  ): Promise<SaveOutcome>;
  /** 그 앱을 이 컴퓨터에 들여 release를 준비한다. 켜는 것은 앱 workspace의 lophn이고 사람은 그때 동의를 본다. */
  takeIn(app: string): Promise<TakeInOutcome>;
  /** OS 폴더 선택기. 사람이 그만두면 null이다. 선택기가 없는 창은 unavailable이다. */
  pickFolder(): Promise<SourceResult<string | null>>;
  /** 송수신 파일 transfer 목록(`transfers/list`). */
  transfers(): Promise<SourceResult<readonly TransferRecord[]>>;
  /** transfer 기록 정리(`transfers/clear`). */
  clearTransfer(
    id: string,
    deleteInboxFiles?: boolean,
  ): Promise<SourceResult<null>>;
  /** OS 파일 관리자에서 inbox 경로를 연다. */
  openInbox?(path: string): Promise<SourceResult<null>>;
  /** 대기 중인 설정/workflow 배치 목록(`settings_export/staged`). */
  stagedSettings(): Promise<SourceResult<readonly StagedSettingsBatch[]>>;
  /** staged 설정 적용(`settings_export/apply`). `confirmPermissions`는 사람이 명시적으로 확인했을 때만 true다. */
  applyStagedSettings(input: {
    readonly batch: string;
    readonly itemIds?: readonly string[];
    readonly overwrite?: boolean;
    readonly confirmPermissions?: boolean;
  }): Promise<SourceResult<StagedSettingsApplyOutcome>>;
  /** staged 설정 배치 닫기(`settings_export/dismiss`). */
  dismissStagedSettings(batch: string): Promise<SourceResult<null>>;
}
