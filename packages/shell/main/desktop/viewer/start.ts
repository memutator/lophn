// The start machine: `<root>/shell/viewer/start.json` (`{machine, start, last, last_name}`, 0600, written to a temp file and
// renamed). It is read before the core answers, so the first window does not wait for it. `machine` is the id of the
// machine that wrote it: a file from another machine (a copied data root) opens this computer. `last_name` titles the last
// used machine's window until the machine list arrives.
import { join } from "node:path";
import { z } from "zod";

import type { Id } from "../../../../protocol/base/ids.ts";
import {
  machineIdSchema as machineId,
  machineStartSchema,
} from "../../../ipc/machines.ts";
import {
  defaultStoreDeps,
  type StoreDeps,
  writeFileAtomic,
} from "../../workspace/atomic-file.ts";

const startFileSchema = z.strictObject({
  machine: machineId,
  start: machineStartSchema,
  // The machine of the last window that got focus while connected; may be this machine.
  last: machineId.nullable(),
  last_name: z.string().nullable(),
});
export type StartFile = z.infer<typeof startFileSchema>;

const fileOf = (dataRoot: string) =>
  join(dataRoot, "shell", "viewer", "start.json");

/** Null when the file is missing or unreadable. */
export async function readStart(
  dataRoot: string,
  fs: Pick<StoreDeps, "readFile"> = defaultStoreDeps,
): Promise<StartFile | null> {
  try {
    const text = new TextDecoder().decode(await fs.readFile(fileOf(dataRoot)));
    const parsed = startFileSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The machine the first window opens on, read before the core answers: the chosen one, else the last used one. Null (this
 * computer's window) when there is no file, the file is another machine's, or the start is this machine.
 */
export async function startMachine(
  dataRoot: string,
): Promise<{ machine: Id<"mch">; name: string } | null> {
  const saved = await readStart(dataRoot);
  if (saved === null) return null;
  const machine =
    saved.start.mode === "machine" ? saved.start.machine : saved.last;
  if (machine === null || machine === saved.machine) return null;
  return {
    machine,
    name: machine === saved.last ? (saved.last_name ?? "") : "",
  };
}

/** Writes run one after another; the last call's value is what stays. */
export function createStartStore(
  dataRoot: string,
  log: (message: string) => void,
) {
  let writing: Promise<unknown> = Promise.resolve();
  return {
    save(value: StartFile): void {
      const text = `${JSON.stringify(value, null, 2)}\n`;
      writing = writing.then(async () => {
        const written = await writeFileAtomic(fileOf(dataRoot), text);
        if (!written.ok)
          log(`viewer: cannot write start.json: ${written.error.code}`);
      });
    },
  };
}
