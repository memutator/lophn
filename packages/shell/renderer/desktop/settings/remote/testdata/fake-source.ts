// Remote 항목의 가짜 통로. core를 부르지 않고 메모리에 둔다.
import type {
  RemoteDevice,
  RemoteSettingsSource,
  SourceResult,
} from "../source.ts";

interface FakeRemoteOptions {
  /** 처음 `remote.enabled`. 없으면 켜져 있다. */
  enabled?: boolean;
  /** 처음 기기 목록. 없으면 화면 확인용 대표 둘이다. */
  devices?: RemoteDevice[];
}

const HOUR = 60 * 60 * 1000;

function sampleDevices(now: number): RemoteDevice[] {
  return [
    {
      id: "dev_01jd0000000000000000000001",
      name: "Pixel 9",
      os: "android",
      lastConnectedAt: new Date(now - 26 * HOUR).toISOString(),
      primary: false,
    },
    {
      id: "dev_01jd0000000000000000000002",
      name: "iPhone 16",
      os: "ios",
      lastConnectedAt: new Date(now - 2 * HOUR).toISOString(),
      primary: true,
    },
  ];
}

// QR에 싣는 모양 그대로다(`remotePairingSchema`).
const SAMPLE_PAIRING = {
  addresses: ["192.168.0.12", "fd12:3456:789a::12"],
  port: 7432,
  key: "q0nT3vVZ6yWm0z0cX8yFJr6dYb0p5QeTq3m7kXc1Hn4",
  code: "4f1c2b9e0d7a63851f2e9c4b7a0d3e6f",
};

export function fakeRemote(options: FakeRemoteOptions = {}) {
  let enabled = options.enabled ?? true;
  let devices: readonly RemoteDevice[] =
    options.devices ?? sampleDevices(Date.now());
  const ok = <T>(value: T): Promise<SourceResult<T>> =>
    Promise.resolve({ ok: true, value });
  const missing = (): Promise<SourceResult<null>> =>
    Promise.resolve({ ok: false, code: "not_found" });
  const source: RemoteSettingsSource = {
    enabled: () => ok(enabled),
    setEnabled(on) {
      enabled = on;
      return ok(null);
    },
    startPairing: () =>
      enabled
        ? ok({
            qr: JSON.stringify(SAMPLE_PAIRING),
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          })
        : Promise.resolve({ ok: false, code: "unavailable" }),
    relayStatus: () =>
      ok({
        url: "wss://relay.example",
        state: enabled ? ("connected" as const) : ("off" as const),
      }),
    devices: () => ok(devices),
    rename(id, name) {
      if (!devices.some((d) => d.id === id)) return missing();
      devices = devices.map((d) => (d.id === id ? { ...d, name } : d));
      return ok(null);
    },
    revoke(id) {
      if (!devices.some((d) => d.id === id)) return missing();
      devices = devices.filter((d) => d.id !== id);
      return ok(null);
    },
    setPrimary(id) {
      if (!devices.some((d) => d.id === id)) return missing();
      devices = devices.map((d) => ({ ...d, primary: d.id === id }));
      return ok(null);
    },
  };
  return { source };
}
