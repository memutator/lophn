// Remote 항목이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만 안다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

/** pairing한 폰 하나. */
export interface RemoteDevice {
  readonly id: string;
  readonly name: string;
  readonly os: "ios" | "android";
  /** 마지막으로 붙은 때(ISO). 아직 안 붙었으면 null이다. */
  readonly lastConnectedAt: string | null;
  /** 기준 기기. 하나뿐이다. */
  readonly primary: boolean;
}

/** 새 pairing code. */
export interface RemotePairingCode {
  /** QR에 싣는 글. 폰(과 `tools/remote-client.ts`)이 읽는 JSON 그대로다. */
  readonly qr: string;
  /** code가 끝나는 때(ISO). */
  readonly expiresAt: string;
}

export interface RemoteSettingsSource {
  /** 설정 `remote.enabled`. */
  enabled(): Promise<SourceResult<boolean>>;
  setEnabled(on: boolean): Promise<SourceResult<null>>;
  /** 새 code를 만든다. 앞 code는 무효가 된다. listener가 아직 열리지 않았으면 `unavailable`이다. */
  startPairing(): Promise<SourceResult<RemotePairingCode>>;
  /** pairing한 폰들. 만든 순서다. */
  devices(): Promise<SourceResult<readonly RemoteDevice[]>>;
  rename(id: string, name: string): Promise<SourceResult<null>>;
  /** 기기를 지운다. 그 폰은 바로 끊기고 다시 pairing해야 붙는다. */
  revoke(id: string): Promise<SourceResult<null>>;
  setPrimary(id: string): Promise<SourceResult<null>>;
}
