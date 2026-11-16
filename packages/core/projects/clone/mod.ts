import { lstat, readFile, rename, rm, stat } from "node:fs/promises";
import { errorCode } from "../../../base/mod.ts";
import type { CloneFs } from "./clone.ts";

export {
  type CloneDeps,
  type CloneInput,
  type CloneOutput,
  cloneProject,
} from "./clone.ts";
export { type CloneRunner, gitCloneRunner } from "./runner.ts";
export { projectsFolderSetting } from "./setting.ts";

async function missing<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT" || errorCode(thrown) === "ENOTDIR") {
      return empty;
    }
    throw thrown;
  }
}

export const nodeCloneFs: CloneFs = {
  isDir: (path) => missing(async () => (await stat(path)).isDirectory(), false),
  exists: (path) => missing(async () => (await lstat(path), true), false),
  rename,
  rm: (path) => rm(path, { recursive: true, force: true }),
  readText: (path) => missing(() => readFile(path, "utf8"), null),
};
