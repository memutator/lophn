// SyncSettingsSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output schema로 이미 검사했다.
// 폴더 설정은 값 전체를 새 값으로 쓴다(CLI와 같다). 쓰기 직전에 지금 값을 다시 읽어 그 사이 바뀐 것을 잃지 않는다.
import type { z } from "zod";
import type { settingsUpdate } from "../../../../../protocol/config/file.ts";
import type { MachineEnvironment } from "../../../../../protocol/folder/mod.ts";
import type { carryStatus } from "../../../../../protocol/remote/carry.ts";
import type { rosterList } from "../../../../../protocol/remote/routes.ts";
import type { FolderPickerApi } from "../../../../ipc/folder-picker.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { readAvailable, takeInApp } from "../../../apps/take-in.ts";
import { windowFolderPicker } from "../../workspaces/projects/core-source.ts";
import { call } from "../core-call.ts";
import { readEffective } from "../declared.ts";
import type { SaveOutcome, SyncFolder, SyncSettingsSource } from "./source.ts";

const DESTINATIONS_KEY = "folder.destinations";
const SHARED_KEY = "folder.shared";
const REMOTE_KEY = "remote.enabled";
// 사람이 쓰지 못하는 이름. 앱 선언의 `sync`가 고르는 `"computers"` 폴더라 목록에서 뺀다.
const COMPUTERS = "computers";

type Named = Record<string, { path: string }>;

/** 명단에 같은 machine id를 단 믿는(disputed 아닌) 컴퓨터 항목이 둘 이상인 machine id 목록. `machineSigningKey`와 같은 기준이다. */
export function duplicateRosterMachines(
  devices: readonly Pick<
    z.output<typeof rosterList.output>["devices"][number],
    "kind" | "machine" | "disputed"
  >[],
): string[] {
  const counts = new Map<string, number>();
  for (const device of devices) {
    if (
      device.disputed ||
      device.kind !== "computer" ||
      device.machine === null
    ) {
      continue;
    }
    counts.set(device.machine, (counts.get(device.machine) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([machine]) => machine);
}

export function coreSyncSource(
  core: CoreSource,
  deps: { picker?: FolderPickerApi | undefined } = {},
): SyncSettingsSource {
  const picker = "picker" in deps ? deps.picker : windowFolderPicker();

  async function write(key: string, value: unknown): Promise<SaveOutcome> {
    const sent = await call<z.output<typeof settingsUpdate.output>>(
      core,
      "memory",
      "settings",
      "update",
      { changes: [{ key, action: "set", value }] },
    );
    if (!sent.ok) return { ok: false, reason: "failed", message: null };
    const refusal = sent.value.rejected[0];
    return refusal === undefined
      ? { ok: true }
      : { ok: false, reason: "rejected", message: refusal.message ?? null };
  }

  async function named(): Promise<Named | null> {
    const read = await readEffective(core, [DESTINATIONS_KEY]);
    return read.ok ? ((read.value.get(DESTINATIONS_KEY) as Named) ?? {}) : null;
  }

  return {
    async folders() {
      const read = await readEffective(core, [
        DESTINATIONS_KEY,
        SHARED_KEY,
        REMOTE_KEY,
      ]);
      if (!read.ok) return read;
      // 폴더 상태는 환경 보기가 말한다. 읽지 못하면 상태만 모른다.
      const environment = await call<MachineEnvironment>(
        core,
        "read",
        "machine",
        "environment",
        {},
      );
      const states = new Map(
        environment.ok
          ? environment.value.destinations.map((one) => [one.name, one.state])
          : [],
      );
      const destinations = (read.value.get(DESTINATIONS_KEY) ?? {}) as Named;
      const shared = read.value.get(SHARED_KEY) as { path: string } | null;
      return {
        ok: true,
        value: {
          shared: shared?.path ?? null,
          named: Object.entries(destinations)
            .filter(([name]) => name !== COMPUTERS)
            .map(
              ([name, { path }]): SyncFolder => ({
                name,
                path,
                state: states.get(name) ?? null,
              }),
            ),
          remoteEnabled: read.value.get(REMOTE_KEY) === true,
        },
      };
    },

    async status() {
      const [read, roster, available] = await Promise.all([
        call<z.output<typeof carryStatus.output>>(
          core,
          "read",
          "carry",
          "status",
          {},
        ),
        call<z.output<typeof rosterList.output>>(
          core,
          "memory",
          "roster",
          "list",
          {},
        ),
        readAvailable(core),
      ]);
      if (!read.ok) return read;
      return {
        ok: true,
        value: {
          shared: read.value.shared,
          received: read.value.machines.map((row) => ({
            machine: row.machine,
            receivedAt: row.received_at,
            via: row.via,
          })),
          apps: read.value.apps.map((row) => ({
            app: row.app,
            name: row.name,
            destination: row.destination,
            readAt: row.read_at,
          })),
          duplicateMachines: roster.ok
            ? duplicateRosterMachines(roster.value.devices)
            : [],
          available: available.ok ? available.value : [],
        },
      };
    },

    takeIn: (app) => takeInApp(core, app),

    async saveNamed({ name, path, was }) {
      const current = await named();
      if (current === null)
        return { ok: false, reason: "failed", message: null };
      const next = { ...current };
      if (was !== null) delete next[was];
      next[name] = { path };
      return write(DESTINATIONS_KEY, next);
    },

    async removeNamed(name) {
      const current = await named();
      if (current === null)
        return { ok: false, reason: "failed", message: null };
      const next = { ...current };
      delete next[name];
      return write(DESTINATIONS_KEY, next);
    },

    setShared: (path) => write(SHARED_KEY, path === null ? null : { path }),

    async pickFolder() {
      if (picker === undefined) return { ok: false, code: "unavailable" };
      const picked = await picker.pick();
      return picked.ok
        ? { ok: true, value: picked.path }
        : { ok: false, code: picked.code };
    },
  };
}
