// artifact 폴더 하나를 지운다. 지운 폴더는 rewind로 되살릴 수 없어서 이 함수가 폴더 밖을 건드리지 않게
// 막는 마지막 문이다. 폴더 이름은 다시 slug로 검사하고, symlink 폴더는 따라가지 않고 거절한다.
import type { Stats } from "node:fs";
import { lstat, realpath, rm } from "node:fs/promises";
import { join, sep } from "node:path";

import { err, ok, type Result } from "../../../base/result.ts";
import { artifactNameSchema } from "../../ipc/artifact.ts";

export type ArtifactDeleteFs = {
  lstat(path: string): Promise<Pick<Stats, "isDirectory" | "isSymbolicLink">>;
  realpath(path: string): Promise<string>;
  /** symlink는 따라가지 않고 link 자체를 지운다(node의 fs.rm이 그렇다). */
  rm(path: string): Promise<void>;
};

export const nodeArtifactDeleteFs: ArtifactDeleteFs = {
  lstat,
  realpath,
  rm: (path) => rm(path, { recursive: true }),
};

/** `folder`는 그릇의 `artifacts/` 폴더, `name`은 그 안 artifact 이름이다. */
export async function deleteArtifactFolder(
  folder: string,
  name: string,
  fs: ArtifactDeleteFs = nodeArtifactDeleteFs,
): Promise<Result<null>> {
  if (!artifactNameSchema.safeParse(name).success) {
    return err({ code: "invalid_input", message: "invalid artifact name" });
  }
  const target = join(folder, name);
  let info: Awaited<ReturnType<ArtifactDeleteFs["lstat"]>>;
  try {
    info = await fs.lstat(target);
  } catch {
    return notFound();
  }
  if (info.isSymbolicLink()) {
    return err({
      code: "forbidden",
      message: "artifact folder is a symbolic link",
    });
  }
  if (!info.isDirectory()) return notFound();
  try {
    // 접두사만 같은 형제 폴더(artifacts-x)가 밖이 되도록 구분자까지 붙여 비교한다.
    const real = await fs.realpath(target);
    if (!real.startsWith((await fs.realpath(folder)) + sep)) {
      return err({
        code: "forbidden",
        message: "artifact folder is outside artifacts",
      });
    }
  } catch {
    return notFound();
  }
  try {
    await fs.rm(target);
  } catch {
    return err({ code: "internal", message: "could not delete the artifact" });
  }
  return ok(null);
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "artifact not found" });
}
