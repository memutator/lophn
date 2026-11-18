// Remote 항목이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만 안다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

/** 내 기기 명단의 기기 하나. 이름과 터미널 입력 허락은 명단에 있어 모든 기계에 같다. */
export interface RemoteDevice {
  readonly id: string;
  readonly kind: "phone" | "computer";
  readonly name: string;
  readonly os: "ios" | "android" | "linux" | "macos" | "windows";
  /** 컴퓨터의 기계 id. 폰은 null이다. 기계 목록(`MachinesView`)의 상태와 잇는다. */
  readonly machine: string | null;
  /** 이 컴퓨터의 항목이다. */
  readonly thisComputer: boolean;
  /** 마지막으로 이 컴퓨터에 붙은 때(ISO). 아직 안 붙었으면 null이다. */
  readonly lastConnectedAt: string | null;
  /** 이 컴퓨터의 기준 폰. 하나뿐이고 폰만 된다. */
  readonly primary: boolean;
  /** 이 기기가 터미널에 칠 수 있는가. 초대장에서 정한 값으로 시작하고 어느 컴퓨터에서나 바꾼다. */
  readonly terminalInput: boolean;
  /** 초대한 컴퓨터가 꺼져 있을 때 들어와 그 소식이 아직 닿지 않았다(기다리는 중). */
  readonly pending: boolean;
}

/** 명단과, 다른 컴퓨터가 이 컴퓨터를 빼 명단을 버린 때(ISO. core가 다시 뜨거나 다시 들면 null). */
export interface RemoteDevices {
  readonly devices: readonly RemoteDevice[];
  readonly removedAt: string | null;
}

/** 이 컴퓨터의 이름과 복제 여부(`machine/status`). */
export interface RemoteMachine {
  /** 알리는 이름: 사람이 지은 이름이 있으면 그것, 없으면 hostname이다. */
  readonly name: string;
  readonly nameSource: "hostname" | "person";
  readonly hostname: string;
  /** 다른 컴퓨터에서 복사된 data root라 새 기계가 되었으면 옛 기계의 id. 아니면 null이다. */
  readonly clonedFrom: string | null;
}

/**
 * 이 컴퓨터를 로그인 때 띄우고 계속 돌리는 표시(`keepRunning`·`keepAwake`)와 OS가 답한 사실(`always_on/status`).
 * `startAtLogin`은 표시와 상관없는 OS의 사실이라 표시가 꺼져 있어도 `registered`일 수 있다(지우기 실패).
 */
export interface AlwaysOnView {
  readonly keepRunning: boolean;
  readonly keepAwake: boolean;
  readonly startAtLogin:
    | "registered"
    | "not_registered"
    | "off_in_system"
    | "unavailable";
  /** `startAtLogin`이 `unavailable`일 때만 있다. */
  readonly loginReason:
    | "development_build"
    | "no_service_manager"
    | "unverified_path"
    | "os_failed"
    | null;
  readonly awake: "held" | "released" | "unavailable";
  readonly awakeReason: "no_inhibitor" | "os_failed" | null;
  /** 개발 core는 null이다. */
  readonly mechanism: "systemd" | "launchd" | "windows_run" | null;
}

/** 새 초대장. */
export interface RemoteInvite {
  /** QR과 "Show as text"에 싣는 글. 폰과 `lophn remote join`이 읽는 JSON 그대로다. */
  readonly text: string;
  /** 초대장이 끝나는 때(ISO). */
  readonly expiresAt: string;
}

/** 초대장으로 들기의 결과. pending은 초대한 컴퓨터에 아직 닿지 못했다(그 컴퓨터를 아는 기기가 붙으면 끝난다). */
export type JoinOutcome =
  | { readonly ok: true; readonly pending: boolean }
  | {
      readonly ok: false;
      readonly reason:
        | "invalid_text"
        | "expired"
        | "used"
        | "untrusted"
        | "removed"
        | "this_computer"
        | "id_taken"
        | "key_taken"
        /** 판이 어긋났다. client는 이 컴퓨터의 lophn을, host는 초대한 컴퓨터의 lophn을 올린다. */
        | "update_client"
        | "update_host"
        | "unavailable"
        | "failed";
    };

/** relay 연결. `url`이 null이면 relay 설정이 없다. 붙지 못했거나 붙는 중이면 `connecting`이다. */
export interface RemoteRelayStatus {
  readonly url: string | null;
  readonly state: "off" | "connecting" | "connected";
}

export interface RemoteSettingsSource {
  /** 이 컴퓨터의 이름. */
  machine(): Promise<SourceResult<RemoteMachine>>;
  /** 이름을 바꾼다. null이면 사람이 지은 이름을 지워 hostname을 다시 따른다. */
  renameMachine(name: string | null): Promise<SourceResult<RemoteMachine>>;
  /** 이 컴퓨터의 "Keep running" 표시와 OS 등록의 사실. core가 OS에 다시 묻는다. */
  alwaysOn(): Promise<SourceResult<AlwaysOnView>>;
  /** 표시를 바꾼다. 같은 `keepRunning: true`를 다시 보내면 등록을 다시 쓴다. 결과는 바꾼 뒤의 사실이다. */
  setAlwaysOn(input: {
    keepRunning?: boolean;
    keepAwake?: boolean;
  }): Promise<SourceResult<AlwaysOnView>>;
  /** 설정 `remote.enabled`. */
  enabled(): Promise<SourceResult<boolean>>;
  setEnabled(on: boolean): Promise<SourceResult<null>>;
  /** 초대장을 낸다. long은 새 기기가 이 컴퓨터와 같은 때 켜질 수 없을 때다(7일, 기본 30분). remote가 꺼져 있으면 unavailable이다. */
  invite(input: {
    kind: "phone" | "computer";
    terminalInput: boolean;
    lifetime: "short" | "long";
  }): Promise<SourceResult<RemoteInvite>>;
  /** 다른 컴퓨터의 초대장으로 이 컴퓨터가 그 명단에 든다. */
  join(text: string): Promise<JoinOutcome>;
  relayStatus(): Promise<SourceResult<RemoteRelayStatus>>;
  /** 이 컴퓨터가 믿는 명단의 기기들. */
  devices(): Promise<SourceResult<RemoteDevices>>;
  /** 명단의 이름을 바꾼다. 이 컴퓨터의 이름은 `renameMachine`이다. */
  rename(id: string, name: string): Promise<SourceResult<null>>;
  /** 명단에서 뺀다. 모든 기계에서 끊기고 그 key는 다시 들지 못한다. */
  remove(id: string): Promise<SourceResult<null>>;
  setPrimary(id: string): Promise<SourceResult<null>>;
  setTerminalInput(id: string, on: boolean): Promise<SourceResult<null>>;
}
