// artifact 탭이 열 대상(artifact 또는 사람의 .html)을 root와 입구 file로 푼다.
// file 시스템은 인자로 받는다. renderer가 사람의 폴더 어느 곳이든 열 수 있어서 file 대상은
// project 폴더 안인지 보지 않는다.
import type { Stats } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, sep } from "node:path";

import { err, ok, type Result } from "../../../base/result.ts";
import { artifactNameSchema } from "../../ipc/artifact.ts";
import {
  ARTIFACT_ENTRY,
  ARTIFACTS_FOLDER,
} from "../../../protocol/projects/artifact.ts";

export type ArtifactSource =
  | { kind: "artifact"; project: string; name: string }
  | { kind: "file"; project: string; path: string };

export type ResolvedSource = {
  root: string;
  entry: string;
  file: string;
  name: string | null;
};

export type ArtifactFs = {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<Pick<Stats, "isFile">>;
  lstat(path: string): Promise<Pick<Stats, "isFile" | "isDirectory" | "mtime">>;
  readdir(path: string): Promise<string[]>;
  /** 앞 `bytes`만 읽어 글로 돌려준다. */
  readHead(path: string, bytes: number): Promise<string>;
};

export const nodeArtifactFs: ArtifactFs = {
  realpath,
  stat,
  lstat,
  readdir,
  async readHead(path, bytes) {
    const handle = await open(path, "r");
    try {
      const buffer = new Uint8Array(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return new TextDecoder().decode(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  },
};

export async function resolveSource(
  dataRoot: string,
  source: ArtifactSource,
  fs: ArtifactFs,
): Promise<Result<ResolvedSource>> {
  if (source.kind === "file") return await resolveFile(source.path, fs);
  if (!artifactNameSchema.safeParse(source.name).success) {
    return err({ code: "invalid_input", message: "invalid artifact name" });
  }
  const folder = join(dataRoot, "projects", source.project, ARTIFACTS_FOLDER);
  try {
    const root = await fs.realpath(join(folder, source.name));
    // artifact 폴더가 artifacts 밖을 가리키는 symlink면 닫는다.
    if (!root.startsWith((await fs.realpath(folder)) + sep)) return notFound();
    const file = join(root, ARTIFACT_ENTRY);
    if (!(await fs.lstat(file)).isFile()) return notFound();
    return ok({ root, entry: ARTIFACT_ENTRY, file, name: source.name });
  } catch {
    return notFound();
  }
}

async function resolveFile(
  path: string,
  fs: ArtifactFs,
): Promise<Result<ResolvedSource>> {
  const ext = extname(path).toLowerCase();
  if (!isAbsolute(path) || (ext !== ".html" && ext !== ".htm")) {
    return err({
      code: "invalid_input",
      message: "not an absolute .html path",
    });
  }
  try {
    const file = await fs.realpath(path);
    if (!(await fs.stat(file)).isFile()) return notFound();
    return ok({ root: dirname(file), entry: basename(file), file, name: null });
  } catch {
    return notFound();
  }
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "artifact not found" });
}
