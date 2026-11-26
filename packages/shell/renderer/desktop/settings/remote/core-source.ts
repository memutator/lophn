// RemoteSettingsSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output schema로 이미 검사했다.
import type { z } from "zod";
import {
  devicesSetPrimary,
  type machinesList,
  type RemoteDevice as ListedDevice,
  type remoteRelayStatus,
  type rosterInvite,
  type rosterList,
} from "../../../../../protocol/remote/routes.ts";
import type { AlwaysOnStatus } from "../../../../../protocol/always-on/mod.ts";
import type { MachineStatus } from "../../../../../protocol/machine/mod.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { call, command } from "../core-call.ts";
import { chooseSetting, readEffective } from "../declared.ts";
import type {
  AlwaysOnView,
  JoinOutcome,
  RemoteConnectionSettings,
  RemoteMachine,
  RemoteRelayStatus,
  RemoteSettingsSource,
  SourceResult,
} from "./source.ts";

const ENABLED_KEY = "remote.enabled";
const ADDRESSES_KEY = "remote.addresses";
const HUB_KEY = "remote.hub";
const PORT_KEY = "remote.port";
const RELAY_KEY = "remote.relay";
const OSC52_KEY = "shell.terminal.osc52_clipboard";
const DEFAULT_PORT = 7432;
const DEFAULT_RELAY = "wss://lophn-relay.fly.dev";

// `roster/join`의 거절 이유(`details.reason`). 화면이 이유마다 다른 글을 보인다.
const JOIN_REFUSED = {
  expired: true,
  used: true,
  untrusted: true,
  removed: true,
  this_computer: true,
  id_taken: true,
  key_taken: true,
} as const satisfies Partial<
  Record<Extract<JoinOutcome, { ok: false }>["reason"], true>
>;

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

    async addresses() {
      const read = await readEffective(core, [ADDRESSES_KEY]);
      return read.ok
        ? { ok: true, value: (read.value.get(ADDRESSES_KEY) as string[]) ?? [] }
        : read;
    },

    setAddresses: (list) => chooseSetting(core, ADDRESSES_KEY, list),

    async enabled() {
      const read = await readEffective(core, [ENABLED_KEY]);
      return read.ok
        ? { ok: true, value: read.value.get(ENABLED_KEY) === true }
        : read;
    },

    setEnabled: (on) => chooseSetting(core, ENABLED_KEY, on),

    async connectionSettings(): Promise<
      SourceResult<RemoteConnectionSettings>
    > {
      const read = await readEffective(core, [
        HUB_KEY,
        PORT_KEY,
        RELAY_KEY,
        OSC52_KEY,
      ]);
      if (!read.ok) return read;
      const port = read.value.get(PORT_KEY);
      const relay = read.value.get(RELAY_KEY);
      const osc52 = read.value.get(OSC52_KEY);
      return {
        ok: true,
        value: {
          hub: read.value.get(HUB_KEY) === true,
          port: typeof port === "number" ? port : DEFAULT_PORT,
          relay: typeof relay === "string" ? relay : DEFAULT_RELAY,
          osc52Clipboard: osc52 !== false,
        },
      };
    },

    setHub: (on) => chooseSetting(core, HUB_KEY, on),
    setPort: (port) => chooseSetting(core, PORT_KEY, port),
    setRelay: (url) => chooseSetting(core, RELAY_KEY, url),
    setOsc52Clipboard: (on) => chooseSetting(core, OSC52_KEY, on),

    async invite({ kind, terminalInput, lifetime }) {
      const made = await call<z.infer<typeof rosterInvite.output>>(
        core,
        "memory",
        "roster",
        "invite",
        { kind, terminal_input: terminalInput, lifetime },
      );
      if (!made.ok) return made;
      return {
        ok: true,
        value: {
          text: JSON.stringify(made.value.invite),
          expiresAt: made.value.expires_at,
        },
      };
    },

    async join(text, terminalInput) {
      let reply: Awaited<ReturnType<CoreSource["call"]>>;
      try {
        reply = await core.call({
          kind: "memory",
          resource: "roster",
          method: "join",
          body: { text, terminal_input: terminalInput },
        });
      } catch {
        return { ok: false, reason: "unavailable" };
      }
      if (reply.ok) {
        return {
          ok: true,
          pending: (reply.value as { pending: boolean }).pending,
        };
      }
      const reason = reply.error?.details?.["reason"];
      if (typeof reason === "string" && reason in JOIN_REFUSED) {
        return { ok: false, reason: reason as keyof typeof JOIN_REFUSED };
      }
      const update = reply.error?.details?.["update"];
      if (update === "client") return { ok: false, reason: "update_client" };
      if (update === "host") return { ok: false, reason: "update_host" };
      const code = reply.error?.code;
      if (code === "invalid_input")
        return { ok: false, reason: "invalid_text" };
      if (code === "unavailable") return { ok: false, reason: "unavailable" };
      return { ok: false, reason: "failed" };
    },

    async relayStatus(): Promise<SourceResult<RemoteRelayStatus>> {
      const read = await call<z.infer<typeof remoteRelayStatus.output>>(
        core,
        "memory",
        "remote_relay",
        "status",
        {},
      );
      if (!read.ok) return read;
      return {
        ok: true,
        value: {
          url: read.value.url,
          state: read.value.state,
          ...(read.value.hub_listening === undefined
            ? {}
            : { hubListening: read.value.hub_listening }),
        },
      };
    },

    async devices() {
      const [roster, rows, listedMachines, settings] = await Promise.all([
        call<z.infer<typeof rosterList.output>>(
          core,
          "memory",
          "roster",
          "list",
          {},
        ),
        call<{ devices: ListedDevice[] }>(core, "read", "devices", "list", {}),
        call<z.infer<typeof machinesList.output>>(
          core,
          "memory",
          "machines",
          "list",
          {},
        ),
        readEffective(core, [HUB_KEY]),
      ]);
      if (!roster.ok) return roster;
      // 기준 폰은 이 컴퓨터의 기기 행에만 있다.
      const primary = rows.ok
        ? rows.value.devices.find((row) => row.primary)?.id
        : undefined;
      const hubByMachine = new Map<string, boolean>(
        listedMachines.ok
          ? listedMachines.value.machines.map((one) => [
              one.machine,
              one.hub === true,
            ])
          : [],
      );
      const thisHub = settings.ok && settings.value.get(HUB_KEY) === true;
      return {
        ok: true,
        value: {
          removedAt: roster.value.removed_at,
          devices: roster.value.devices.map((device) => ({
            id: device.id,
            key: device.key,
            kind: device.kind,
            name: device.name,
            os: device.os,
            machine: device.machine,
            thisComputer: device.this,
            lastConnectedAt: device.last_connected_at,
            primary: device.id === primary,
            terminalInput: device.terminal_input,
            pending: device.pending,
            disputed: device.disputed,
            hub: device.this
              ? thisHub
              : device.machine !== null &&
                hubByMachine.get(device.machine) === true,
          })),
        },
      };
    },

    rename: async (id, name) =>
      done(await call(core, "memory", "roster", "rename", { id, name })),

    remove: async (key) =>
      done(await call(core, "memory", "roster", "remove", { key })),

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
        await call(core, "memory", "roster", "set_terminal_input", { id, on }),
      ),
  };
}
