// This desktop's device key and the machines it views: `<root>/shell/viewer/key.json` and `machines.json` (0600, written to a
// temp file and renamed). Both carry this machine's id: a copy of the data root on another machine finds a different id and
// starts over, so two machines never share one device key. A file that cannot be read is never overwritten (pairings would
// be lost); viewing stays off until it is fixed.
import { join } from "node:path";
import { z } from "zod";

import type { RandomSource } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  generateKeyPair,
  type KeyPair,
  remoteKeyBytes,
  remoteKeyText,
} from "../../../../protocol/remote/client.ts";
import type { Computer } from "../../../../remote-client/mod.ts";
import {
  machineIdSchema as machineId,
  type MachineStart,
  machineStartSchema,
} from "../../../ipc/machines.ts";
import {
  defaultStoreDeps,
  type StoreDeps,
  writeFileAtomic,
} from "../../workspace/atomic-file.ts";

export type Saved = {
  computers: Computer[];
  start: MachineStart;
  // The machine of the last window that got focus while connected; may be this machine.
  last: Id<"mch"> | null;
  // When each machine was last connected or last dropped (ISO).
  seen: Partial<Record<Id<"mch">, string>>;
};

export type Opened = { ok: true; key: KeyPair; saved: Saved } | { ok: false };

export interface ViewerStore {
  open(): Promise<Opened>;
  // Writes run one after another; the last call's list is what stays.
  save(saved: Saved): Promise<void>;
}

const keyFileSchema = z.object({ machine: machineId, secret_key: z.string() });

const computerSchema = z.object({
  addresses: z.array(z.string()),
  port: z.number().int(),
  key: z.string(),
  relay: z.string().optional(),
  machine: machineId.optional(),
  device: z.string(),
  revoked: z.boolean(),
  name: z.string().optional(),
  announced: z.string().optional(),
});

const machinesFileSchema = z.object({
  machine: machineId,
  computers: z.array(computerSchema),
  start: machineStartSchema,
  last: machineId.nullable(),
  seen: z.record(z.string(), z.string()),
});

const EMPTY: Saved = {
  computers: [],
  start: { mode: "last" },
  last: null,
  seen: {},
};

type Read<T> = "missing" | "broken" | T;

export function createViewerStore(deps: {
  dataRoot: string;
  machine: Id<"mch">;
  random: RandomSource;
  log: (message: string) => void;
  fs?: Partial<StoreDeps>;
}): ViewerStore {
  const fs: StoreDeps = { ...defaultStoreDeps, ...deps.fs };
  const dir = join(deps.dataRoot, "shell", "viewer");
  const keyFile = join(dir, "key.json");
  const machinesFile = join(dir, "machines.json");
  let writing: Promise<void> = Promise.resolve();

  async function read<T>(file: string, schema: z.ZodType<T>): Promise<Read<T>> {
    let text: string;
    try {
      text = new TextDecoder().decode(await fs.readFile(file));
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "missing"
        : "broken";
    }
    try {
      const parsed = schema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : "broken";
    } catch {
      return "broken";
    }
  }

  async function write(file: string, value: unknown): Promise<void> {
    const written = await writeFileAtomic(
      file,
      `${JSON.stringify(value, null, 2)}\n`,
      fs,
    );
    if (!written.ok)
      throw new Error(`cannot write ${file}: ${written.error.code}`);
  }

  return {
    async open() {
      let key = await read(keyFile, keyFileSchema);
      let machines = await read(machinesFile, machinesFileSchema);
      const other = [key, machines].find(
        (one) => typeof one === "object" && one.machine !== deps.machine,
      );
      if (other !== undefined) {
        deps.log(
          `viewer: saved device key and machine list belong to ${(other as { machine: string }).machine}, not ${deps.machine} (copied data root); starting over`,
        );
        await fs.unlink(keyFile).catch(() => {});
        await fs.unlink(machinesFile).catch(() => {});
        key = "missing";
        machines = "missing";
      }
      if (key === "broken" || machines === "broken") return { ok: false };
      const secret =
        key === "missing" ? undefined : remoteKeyBytes(key.secret_key);
      if (key !== "missing" && !secret) return { ok: false };
      let pair: KeyPair;
      if (secret) {
        pair = generateKeyPair({ fill: (out) => out.set(secret) });
      } else {
        pair = generateKeyPair(deps.random);
        await write(keyFile, {
          machine: deps.machine,
          secret_key: remoteKeyText(pair.secretKey),
        });
      }
      if (machines === "missing") return { ok: true, key: pair, saved: EMPTY };
      const { machine: _machine, ...saved } = machines;
      return { ok: true, key: pair, saved: saved as Saved };
    },
    save(saved) {
      writing = writing
        .catch(() => {})
        .then(() => write(machinesFile, { machine: deps.machine, ...saved }));
      return writing;
    },
  };
}
