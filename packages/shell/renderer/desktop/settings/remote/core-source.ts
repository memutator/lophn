// RemoteSettingsSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output schema로 이미 검사했다.
import {
  devicesRename,
  devicesRevoke,
  devicesSetPrimary,
  devicesSetTerminalInput,
  type RemoteDevice as ListedDevice,
} from "../../../../../protocol/remote/routes.ts";
import type { AlwaysOnStatus } from "../../../../../protocol/always-on/mod.ts";
import type { MachineStatus } from "../../../../../protocol/machine/mod.ts";
import type { RemotePairing } from "../../../../../protocol/remote/frames.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { call, command } from "../core-call.ts";
import { chooseSetting, readEffective } from "../declared.ts";
import type {
  AlwaysOnView,
  RemoteMachine,
  RemoteRelayStatus,
  RemoteSettingsSource,
  SourceResult,
} from "./source.ts";

const ENABLED_KEY = "remote.enabled";

const done = (sent: SourceResult<unknown>): SourceResult<null> =>
  sent.ok ? { ok: true, value: null } : sent;

function machineOf(
  status: SourceResult<MachineStatus>,
): SourceResult<RemoteMachine> {
  if (!status.ok) return status;
  const { name, name_source, hostname, cloned_from } = status.value;
  return {
    ok: true,
    value: {
      name,
      nameSource: name_source,
      hostname,
      clonedFrom: cloned_from,
    },
  };
}

function alwaysOnOf(
  status: SourceResult<AlwaysOnStatus>,
): SourceResult<AlwaysOnView> {
  if (!status.ok) return status;
  const s = status.value;
  return {
    ok: true,
    value: {
      keepRunning: s.keep_running,
      keepAwake: s.keep_awake,
      startAtLogin: s.start_at_login,
      loginReason: s.login_reason,
      awake: s.awake,
      awakeReason: s.awake_reason,
      mechanism: s.mechanism,
    },
  };
}

export function coreRemoteSource(
  core: CoreSource,
  random: () => string = () => crypto.randomUUID(),
): RemoteSettingsSource {
  return {
    async machine() {
      return machineOf(
        await call<MachineStatus>(core, "memory", "machine", "status", {}),
      );
    },

    async renameMachine(name) {
      return machineOf(
        await call<MachineStatus>(core, "memory", "machine", "rename", {
          name,
        }),
      );
    },

    async alwaysOn() {
      return alwaysOnOf(
        await call<AlwaysOnStatus>(core, "memory", "always_on", "status", {}),
      );
    },

    async setAlwaysOn({ keepRunning, keepAwake }) {
      return alwaysOnOf(
        await call<AlwaysOnStatus>(core, "memory", "always_on", "set", {
          ...(keepRunning === undefined ? {} : { keep_running: keepRunning }),
          ...(keepAwake === undefined ? {} : { keep_awake: keepAwake }),
        }),
      );
    },

    async enabled() {
      const read = await readEffective(core, [ENABLED_KEY]);
      return read.ok
        ? { ok: true, value: read.value.get(ENABLED_KEY) === true }
        : read;
    },

    setEnabled: (on) => chooseSetting(core, ENABLED_KEY, on),

    async startPairing() {
      const started = await call<RemotePairing & { expires_at: string }>(
        core,
        "memory",
        "pairing",
        "start",
        {},
      );
      if (!started.ok) return started;
      // QR은 `remotePairingSchema`(strict)가 읽는 칸만 싣는다. 끝나는 때는 폰이 쓰지 않는다.
      const { addresses, port, key, code, relay } = started.value;
      const pairing: RemotePairing = {
        addresses,
        port,
        key,
        code,
        ...(relay === undefined ? {} : { relay }),
      };
      return {
        ok: true,
        value: {
          qr: JSON.stringify(pairing),
          expiresAt: started.value.expires_at,
        },
      };
    },

    relayStatus: () =>
      call<RemoteRelayStatus>(core, "memory", "remote_relay", "status", {}),

    async devices() {
      const read = await call<{ devices: ListedDevice[] }>(
        core,
        "read",
        "devices",
        "list",
        {},
      );
      if (!read.ok) return read;
      return {
        ok: true,
        value: read.value.devices.map((device) => ({
          id: device.id,
          kind: device.kind,
          name: device.name,
          announcedName: device.announced_name,
          alias: device.alias,
          os: device.os,
          lastConnectedAt: device.last_connected_at,
          primary: device.primary,
          terminalInput: device.terminal_input,
        })),
      };
    },

    rename: async (id, name) =>
      done(
        await command(core, devicesRename, {
          input: { id, name },
          compare: {},
          key: `device-rename-${random()}`,
        }),
      ),

    revoke: async (id) =>
      done(
        await command(core, devicesRevoke, {
          input: { id },
          compare: {},
          key: `device-revoke-${random()}`,
        }),
      ),

    setPrimary: async (id) =>
      done(
        await command(core, devicesSetPrimary, {
          input: { id },
          compare: {},
          key: `device-primary-${random()}`,
        }),
      ),

    setTerminalInput: async (id, on) =>
      done(
        await command(core, devicesSetTerminalInput, {
          input: { id, on },
          compare: {},
          key: `device-terminal-input-${random()}`,
        }),
      ),
  };
}
