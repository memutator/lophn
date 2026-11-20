// data/ 목록을 가상 file `_entries.json`으로 만든다. agent가 목록을 손으로 맞추다 틀리지 않게 한다.
import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { ARTIFACT_ENTRIES_PATH } from "../../../protocol/projects/artifact.ts";

export const ENTRIES_PATH = ARTIFACT_ENTRIES_PATH;

export interface EntriesFs {
  readdir: typeof readdir;
  lstat: typeof lstat;
  realpath: typeof realpath;
}

const nodeFs: EntriesFs = { readdir, lstat, realpath };

/** `<root>/data/` 바로 아래 일반 file만. symlink는 밖으로 가는 것의 이름·크기가 새지 않도록 건너뛴다. */
export async function listDataEntries(
  root: string,
  fs: EntriesFs = nodeFs,
): Promise<string> {
  const dir = join(root, "data");
  const entries: { name: string; size: number; modified: string }[] = [];
  try {
    // data/ 자체가 밖으로 가는 symlink면 비운다.
    if ((await fs.realpath(dir)) === dir) {
      for (const name of (await fs.readdir(dir)).sort()) {
        if (name === "_entries.json") continue;
        const stat = await fs.lstat(join(dir, name));
        if (!stat.isFile()) continue;
        entries.push({
          name,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
    }
  } catch {
    // data/가 없다.
  }
  return JSON.stringify(entries);
}
