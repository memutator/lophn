// Where each other machine's window was last: `<root>/shell/viewer/windows.json`, machine id → bounds and maximized. Kept
// apart from `machines.json`: it is rewritten on every move, and the file holding the pairings should not be. A file that
// cannot be read starts empty (the windows open where this computer's last window was).
import { join } from "node:path";
import { z } from "zod";

import type { Id } from "../../../../protocol/base/ids.ts";
import {
  defaultStoreDeps,
  type StoreDeps,
  writeFileAtomic,
} from "../../workspace/atomic-file.ts";
import { windowBounds } from "../../workspace/schema.ts";

const placeSchema = z.strictObject({
  bounds: windowBounds,
  maximized: z.boolean(),
});
export type WindowPlace = z.infer<typeof placeSchema>;

export interface WindowPlaces {
  /** Resolves once the file has been read (or found missing or broken). */
  readonly loaded: Promise<void>;
  get(machine: Id<"mch">): WindowPlace | undefined;
  save(machine: Id<"mch">, place: WindowPlace): void;
}

export function createWindowPlaces(
  dataRoot: string,
  deps: Partial<StoreDeps> = {},
): WindowPlaces {
  const fs: StoreDeps = { ...defaultStoreDeps, ...deps };
  const file = join(dataRoot, "shell", "viewer", "windows.json");
  let places: Record<string, WindowPlace> = {};
  let writing: Promise<unknown> = Promise.resolve();
  const loaded = (async () => {
    try {
      const parsed = z
        .record(z.string(), placeSchema)
        .safeParse(
          JSON.parse(new TextDecoder().decode(await fs.readFile(file))),
        );
      if (parsed.success) places = { ...parsed.data, ...places };
    } catch {
      // Missing or broken: start empty.
    }
  })();
  return {
    loaded,
    get: (machine) => places[machine],
    save(machine, place) {
      places = { ...places, [machine]: place };
      const text = JSON.stringify(places);
      // Writes run one after another so the last place is what stays.
      writing = writing.then(() => writeFileAtomic(file, text, fs));
    },
  };
}
