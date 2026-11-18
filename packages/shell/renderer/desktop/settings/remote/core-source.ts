// RemoteSettingsSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output schema로 이미 검사했다.
import type { z } from "zod";
import {
  devicesSetPrimary,
  type RemoteDevice as ListedDevice,
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
  RemoteMachine,
  RemoteRelayStatus,
  RemoteSettingsSource,
  SourceResult,
} from "./source.ts";

const ENABLED_KEY = "remote.enabled";

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

    async enabled() {
      const read = await readEffective(core, [ENABLED_KEY]);
      return read.ok
        ? { ok: true, value: read.value.get(ENABLED_KEY) === true }
        : read;
    },

    setEnabled: (on) => chooseSetting(core, ENABLED_KEY, on),

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

    async join(text) {
      let reply: Awaited<ReturnType<CoreSource["call"]>>;
      try {
        reply = await core.call({
          kind: "memory",
          resource: "roster",
          method: "join",
          body: { text },
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

    relayStatus: () =>
      call<RemoteRelayStatus>(core, "memory", "remote_relay", "status", {}),

    async devices() {
      const [roster, rows] = await Promise.all([
        call<z.infer<typeof rosterList.output>>(
          core,
          "memory",
          "roster",
          "list",
          {},
        ),
        call<{ devices: ListedDevice[] }>(core, "read", "devices", "list", {}),
      ]);
      if (!roster.ok) return roster;
      // 기준 폰은 이 컴퓨터의 기기 행에만 있다.
      const primary = rows.ok
        ? rows.value.devices.find((row) => row.primary)?.id
        : undefined;
      return {
        ok: true,
        value: roster.value.devices.map((device) => ({
          id: device.id,
          kind: device.kind,
          name: device.name,
          os: device.os,
          machine: device.machine,
          thisComputer: device.this,
          lastConnectedAt: device.last_connected_at,
          primary: device.id === primary,
          terminalInput: device.terminal_input,
          pending: device.pending,
        })),
      };
    },

    rename: async (id, name) =>
      done(await call(core, "memory", "roster", "rename", { id, name })),

    remove: async (id) =>
      done(await call(core, "memory", "roster", "remove", { id })),

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
