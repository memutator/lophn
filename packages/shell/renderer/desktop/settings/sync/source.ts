// Settings › Sync가 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만 안다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

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

/** 앱의 `sync_to`와 다른 기계의 변경을 마지막으로 읽은 때(ISO). 읽은 적이 없으면 null이다. */
export interface SyncAppRow {
  readonly app: string;
  readonly name: string;
  readonly syncTo: string;
  readonly readAt: string | null;
}

export interface SyncStatus {
  /** 쓸 수 있는 같이 보는 폴더의 상태. 정하지 않았거나 쓰지 못하는 값이면 null이다. */
  readonly shared: Pick<SyncFolder, "path" | "state"> | null;
  readonly received: readonly SyncReceived[];
  readonly apps: readonly SyncAppRow[];
  /** 명단에 같은 machine id를 단 컴퓨터 항목이 둘 이상인 기계. 받는 쪽이 manifest 서명을 믿지 않아 carry가 멈춘다. */
  readonly duplicateMachines: readonly string[];
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
  /** OS 폴더 선택기. 사람이 그만두면 null이다. 선택기가 없는 창은 unavailable이다. */
  pickFolder(): Promise<SourceResult<string | null>>;
}
