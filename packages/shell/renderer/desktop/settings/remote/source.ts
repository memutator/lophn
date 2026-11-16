// Remote 항목이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만 안다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

/** pairing한 기기 하나. 폰이거나 다른 기계의 lophn(desktop)이다. */
export interface RemoteDevice {
  readonly id: string;
  readonly kind: "phone" | "desktop";
  /** 보이는 이름: 별명이 있으면 별명, 없으면 기기가 알린 이름. */
  readonly name: string;
  /** 기기가 마지막으로 알린 이름. */
  readonly announcedName: string;
  /** 사람이 붙인 별명. 없으면 null이다. */
  readonly alias: string | null;
  readonly os: "ios" | "android" | "linux" | "macos" | "windows";
  /** 마지막으로 붙은 때(ISO). 아직 안 붙었으면 null이다. */
  readonly lastConnectedAt: string | null;
  /** 기준 기기. 하나뿐이고 폰만 된다. */
  readonly primary: boolean;
  /** 이 폰이 coding agent 터미널에 칠 수 있는가. 기본 꺼짐이고 사람이 여기서만 켠다. */
  readonly terminalInput: boolean;
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

/** 새 pairing code. */
export interface RemotePairingCode {
  /** QR에 싣는 글. 폰(과 `tools/remote-client.ts`)이 읽는 JSON 그대로다. */
  readonly qr: string;
  /** code가 끝나는 때(ISO). */
  readonly expiresAt: string;
}

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
  /** 새 code를 만든다. 앞 code는 무효가 된다. listener도 relay 연결도 아직 없으면 `unavailable`이다. */
  startPairing(): Promise<SourceResult<RemotePairingCode>>;
  relayStatus(): Promise<SourceResult<RemoteRelayStatus>>;
  /** pairing한 기기들. 만든 순서다. */
  devices(): Promise<SourceResult<readonly RemoteDevice[]>>;
  /** 별명을 둔다. null이면 별명을 지워 기기가 알린 이름이 다시 보인다. */
  rename(id: string, name: string | null): Promise<SourceResult<null>>;
  /** 기기를 지운다. 그 폰은 바로 끊기고 다시 pairing해야 붙는다. */
  revoke(id: string): Promise<SourceResult<null>>;
  setPrimary(id: string): Promise<SourceResult<null>>;
  setTerminalInput(id: string, on: boolean): Promise<SourceResult<null>>;
}
