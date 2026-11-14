// RemoteSettingsSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output schema로 이미 검사했다.
import {
  devicesRename,
  devicesRevoke,
  devicesSetPrimary,
  type RemoteDevice as ListedDevice,
  type RemotePairing,
} from "../../../../../protocol/remote/routes.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { call, command } from "../core-call.ts";
import { chooseSetting, readEffective } from "../declared.ts";
import type { RemoteSettingsSource, SourceResult } from "./source.ts";

const ENABLED_KEY = "remote.enabled";

const done = (sent: SourceResult<unknown>): SourceResult<null> =>
  sent.ok ? { ok: true, value: null } : sent;

export function coreRemoteSource(
  core: CoreSource,
  random: () => string = () => crypto.randomUUID(),
): RemoteSettingsSource {
  return {
    watch: (listener) => core.subscribe(listener),

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
      // QR은 `remotePairingSchema`(strict)가 읽는 네 칸만 싣는다. 끝나는 때는 폰이 쓰지 않는다.
      const { addresses, port, key, code } = started.value;
      const pairing: RemotePairing = { addresses, port, key, code };
      return {
        ok: true,
        value: {
          qr: JSON.stringify(pairing),
          expiresAt: started.value.expires_at,
        },
      };
    },

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
          name: device.name,
          os: device.os,
          lastConnectedAt: device.last_connected_at,
          primary: device.primary,
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
  };
}
