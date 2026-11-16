// project 폴더의 `.lophn-project.json`을 읽고 쓴다. 사람의 저장소에 file을 만드는 길은 이 file뿐이고 그 file 하나만 쓴다.
import {
  link,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";

import {
  err,
  errorCode,
  type IdSource,
  ok,
  type Result,
} from "../../../base/mod.ts";
import {
  type IdentityFileRead,
  parseIdentityFile,
  PROJECT_IDENTITY_FILE,
  serializeIdentityFile,
} from "../../../protocol/projects/mod.ts";

export type IdentityFs = {
  isFolder(path: string): Promise<boolean>;
  realpath(path: string): Promise<string>;
  read(folder: string): Promise<"absent" | IdentityFileRead>;
  create(folder: string, id: string): Promise<Result<"created" | "exists">>;
  replace(folder: string, id: string): Promise<Result<void>>;
};

function unavailable(thrown: unknown): Result<never> {
  return err({
    code: "unavailable",
    message: thrown instanceof Error ? thrown.message : String(thrown),
  });
}

async function writeTemp(path: string, id: string): Promise<void> {
  const file = await open(path, "wx");
  try {
    await file.writeFile(serializeIdentityFile(id));
    await file.datasync();
  } finally {
    await file.close();
  }
}

export async function readIdentityFile(
  folder: string,
): Promise<"absent" | IdentityFileRead> {
  try {
    return parseIdentityFile(
      await readFile(join(folder, PROJECT_IDENTITY_FILE), "utf8"),
    );
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT") return "absent";
    throw thrown;
  }
}

// 없을 때만 만든다. 다 쓴 temp를 hard link로 걸어 반쯤 쓴 file이 보이지 않고, 있으면(EEXIST) 건드리지 않는다.
// hard link를 못 거는 file system(FAT, 일부 network drive)에서는 `wx`로 직접 만든다. 없을 때만은 같고 반쯤 쓴 file은
// unreadable로 보여 덮지 않는다.
export async function createIdentityFile(
  folder: string,
  id: string,
  tag: string,
): Promise<Result<"created" | "exists">> {
  const target = join(folder, PROJECT_IDENTITY_FILE);
  const temp = `${target}.${tag}.tmp`;
  try {
    await writeTemp(temp, id);
    try {
      await link(temp, target);
      return ok("created");
    } catch (thrown) {
      if (errorCode(thrown) === "EEXIST") return ok("exists");
    }
    await writeTemp(target, id);
    return ok("created");
  } catch (thrown) {
    if (errorCode(thrown) === "EEXIST") return ok("exists");
    return unavailable(thrown);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

// 덮는다. 부르는 곳은 사람이 고른 [Separate project](renew)와 충돌 [Resolve]뿐이다.
export async function replaceIdentityFile(
  folder: string,
  id: string,
  tag: string,
): Promise<Result<void>> {
  const target = join(folder, PROJECT_IDENTITY_FILE);
  const temp = `${target}.${tag}.tmp`;
  try {
    await writeTemp(temp, id);
    await rename(temp, target);
    return ok(undefined);
  } catch (thrown) {
    await rm(temp, { force: true }).catch(() => {});
    return unavailable(thrown);
  }
}

export function createIdentityFs(ids: IdSource): IdentityFs {
  return {
    async isFolder(path) {
      try {
        return (await stat(path)).isDirectory();
      } catch (thrown) {
        if (errorCode(thrown) === "ENOENT" || errorCode(thrown) === "ENOTDIR")
          return false;
        throw thrown;
      }
    },
    realpath: (path) => realpath(path),
    read: readIdentityFile,
    create: (folder, id) => createIdentityFile(folder, id, ids.newId("tmp")),
    replace: (folder, id) => replaceIdentityFile(folder, id, ids.newId("tmp")),
  };
}
