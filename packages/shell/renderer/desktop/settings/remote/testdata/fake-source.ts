// Remote 항목의 가짜 통로. core를 부르지 않고 메모리에 둔다.
import type {
  AlwaysOnView,
  JoinOutcome,
  RemoteDevice,
  RemoteMachine,
  RemoteSettingsSource,
  SourceResult,
} from "../source.ts";

interface FakeRemoteOptions {
  /** 처음 `remote.enabled`. 없으면 켜져 있다. */
  enabled?: boolean;
  /** 처음 명단. 없으면 화면 확인용 대표 다섯(이 컴퓨터, 컴퓨터 둘, 폰 둘)이다. */
  devices?: RemoteDevice[];
  /** 처음 이 컴퓨터. 없으면 hostname을 따른다. 복제 note는 `clonedFrom`을 주고 이 컴퓨터만 든 `devices`로 본다. */
  machine?: RemoteMachine;
  /** 처음 "Keep running" 상태에서 바꿀 칸. 없으면 설치본에서 꺼져 있고 systemd다. */
  alwaysOn?: Partial<AlwaysOnView>;
  /** 표시를 켰을 때 OS 등록이 낳는 답. 없으면 `registered`다. 등록 실패나 개발 build는 이것으로 본다. */
  loginOnSet?: AlwaysOnView["startAtLogin"];
  /** `join`의 결과. 없으면 초대한 컴퓨터에 닿아 끝난다. */
  join?: JoinOutcome;
  /** 다른 컴퓨터가 이 컴퓨터를 뺀 때(ISO). 없으면 빠진 적이 없다. */
  removedAt?: string;
}

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** 기계 id는 기계 보기 fake(`machines/testdata`)의 대표와 같아 컴퓨터 줄에 그 상태가 선다. */
export function sampleDevices(now = Date.now()): RemoteDevice[] {
  const device = (
    id: string,
    fields: Omit<RemoteDevice, "id" | "pending" | "thisComputer" | "disputed"> &
      Partial<Pick<RemoteDevice, "pending" | "thisComputer" | "disputed">>,
  ): RemoteDevice => ({
    id: `dev_01jd00000000000000000000${id}`,
    pending: false,
    disputed: false,
    thisComputer: false,
    ...fields,
  });
  return [
    device("01", {
      kind: "computer",
      name: "Studio",
      os: "linux",
      machine: "mch_studio",
      thisComputer: true,
      lastConnectedAt: null,
      primary: false,
      terminalInput: true,
    }),
    device("02", {
      kind: "computer",
      name: "Home server",
      os: "macos",
      machine: "mch_homeserver",
      lastConnectedAt: new Date(now).toISOString(),
      primary: false,
      terminalInput: true,
    }),
    device("03", {
      kind: "computer",
      name: "Work laptop",
      os: "windows",
      machine: "mch_laptop",
      lastConnectedAt: new Date(now - 3 * HOUR).toISOString(),
      primary: false,
      terminalInput: false,
    }),
    device("04", {
      kind: "phone",
      name: "Pixel 9",
      os: "android",
      machine: null,
      lastConnectedAt: new Date(now - 26 * HOUR).toISOString(),
      primary: false,
      terminalInput: false,
    }),
    device("05", {
      kind: "phone",
      name: "iPhone 16",
      os: "ios",
      machine: null,
      lastConnectedAt: new Date(now - 2 * HOUR).toISOString(),
      primary: true,
      terminalInput: true,
    }),
  ];
}

// 초대장 글의 모양(`rosterInviteTextSchema`)만 흉내 낸다. 서명은 맞지 않는다.
function sampleInvite(kind: "phone" | "computer", expiresAt: string): string {
  return JSON.stringify({
    invite: {
      body: {
        type: "invite",
        key: "Jx3m0QeTq3m7kXc1Hn4q0nT3vVZ6yWm0z0cX8yFJr6c",
        by: "dev_01jd0000000000000000000001",
        kind,
        terminal_input: true,
        expires_at: expiresAt,
      },
      signature: `${"s".repeat(85)}A`,
    },
    secret: "q0nT3vVZ6yWm0z0cX8yFJr6dYb0p5QeTq3m7kXc1Hn4",
    reach: {
      device: "dev_01jd0000000000000000000001",
      addresses: ["192.168.0.12"],
      port: 7432,
      relay: null,
    },
  });
}

const SAMPLE_MACHINE: RemoteMachine = {
  name: "studio",
  nameSource: "hostname",
  hostname: "studio",
  clonedFrom: null,
};

const SAMPLE_ALWAYS_ON: AlwaysOnView = {
  keepRunning: false,
  keepAwake: false,
  startAtLogin: "not_registered",
  loginReason: null,
  awake: "released",
  awakeReason: null,
  mechanism: "systemd",
};

export function fakeRemote(options: FakeRemoteOptions = {}) {
  let alwaysOn: AlwaysOnView = { ...SAMPLE_ALWAYS_ON, ...options.alwaysOn };
  let machine = options.machine ?? SAMPLE_MACHINE;
  let enabled = options.enabled ?? true;
  let devices: readonly RemoteDevice[] =
    options.devices ?? sampleDevices(Date.now());
  const ok = <T>(value: T): Promise<SourceResult<T>> =>
    Promise.resolve({ ok: true, value });
  const missing = (): Promise<SourceResult<null>> =>
    Promise.resolve({ ok: false, code: "not_found" });
  const source: RemoteSettingsSource = {
    machine: () => ok(machine),
    renameMachine(name) {
      machine = {
        ...machine,
        name: name ?? machine.hostname,
        nameSource: name === null ? "hostname" : "person",
      };
      return ok(machine);
    },
    alwaysOn: () => ok(alwaysOn),
    setAlwaysOn({ keepRunning, keepAwake }) {
      // 개발 core는 켤 수 없다.
      if (
        alwaysOn.loginReason === "development_build" &&
        (keepRunning === true || keepAwake === true)
      ) {
        return Promise.resolve({ ok: false, code: "unavailable" });
      }
      if (keepRunning === true) {
        alwaysOn = {
          ...alwaysOn,
          keepRunning: true,
          startAtLogin: options.loginOnSet ?? "registered",
        };
      }
      if (keepRunning === false) {
        alwaysOn = {
          ...alwaysOn,
          keepRunning: false,
          keepAwake: false,
          startAtLogin: "not_registered",
          awake: "released",
        };
      }
      if (keepAwake !== undefined && alwaysOn.keepRunning) {
        alwaysOn = {
          ...alwaysOn,
          keepAwake,
          awake: keepAwake ? "held" : "released",
        };
      }
      return ok(alwaysOn);
    },
    enabled: () => ok(enabled),
    setEnabled(on) {
      enabled = on;
      return ok(null);
    },
    invite({ kind, lifetime }) {
      if (!enabled) return Promise.resolve({ ok: false, code: "unavailable" });
      const expiresAt = new Date(
        Date.now() + (lifetime === "long" ? 7 * 24 * HOUR : 30 * MINUTE),
      ).toISOString();
      return ok({ text: sampleInvite(kind, expiresAt), expiresAt });
    },
    join: () => Promise.resolve(options.join ?? { ok: true, pending: false }),
    relayStatus: () =>
      ok({
        url: "wss://relay.example",
        state: enabled ? ("connected" as const) : ("off" as const),
      }),
    devices: () => ok({ devices, removedAt: options.removedAt ?? null }),
    rename(id, name) {
      if (!devices.some((d) => d.id === id)) return missing();
      devices = devices.map((d) => (d.id === id ? { ...d, name } : d));
      return ok(null);
    },
    remove(id) {
      if (!devices.some((d) => d.id === id)) return missing();
      devices = devices.filter((d) => d.id !== id);
      return ok(null);
    },
    setPrimary(id) {
      if (!devices.some((d) => d.id === id)) return missing();
      devices = devices.map((d) => ({ ...d, primary: d.id === id }));
      return ok(null);
    },
    setTerminalInput(id, on) {
      if (!devices.some((d) => d.id === id)) return missing();
      devices = devices.map((d) =>
        d.id === id ? { ...d, terminalInput: on } : d,
      );
      return ok(null);
    },
  };
  return { source };
}
