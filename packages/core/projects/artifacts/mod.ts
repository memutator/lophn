// 다른 컴퓨터가 읽는 artifact(`artifacts/*` route)의 core 쪽 처리. data root 아래 그릇의 `artifacts/<name>/`만 열고, 목록은
// shell main의 목록 규칙과 같다(입구 `index.html`이 일반 file인 slug 폴더). 동기 file API는 core graph에 두지 않는다.
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, rm } from "node:fs/promises";
import { join, sep } from "node:path";

import { err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  ARTIFACT_ENTRIES_PATH,
  ARTIFACT_ENTRY,
  type ArtifactWorkspace,
  artifactsFolder,
  artifactWorkspaceOf,
  parseArtifactMeta,
} from "../../../protocol/projects/artifact.ts";
import {
  artifactsDelete,
  artifactsFile,
  artifactsList,
} from "../../../protocol/projects/artifact-api.ts";
import { artifactNameSchema } from "../../../protocol/projects/values.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import {
  bytesFileStream,
  type FileStreamHandler,
  type MemoryHandler,
} from "../../server/mod.ts";

// shell main이 이 컴퓨터의 artifact를 여는 상한(ARTIFACT_MAX_BYTES)과 같다. 넘으면 not_found다.
export const ARTIFACT_FILE_MAX_BYTES = 4 * 1024 * 1024;
const HEAD_BYTES = 64 * 1024;

const notFound = (message: string): Result<never> =>
  err({ code: "not_found", message });

export async function listArtifacts(
  dataRoot: string,
  workspace: ArtifactWorkspace,
): Promise<
  {
    name: string;
    title: string;
    description: string;
    modified: string;
  }[]
> {
  const folder = artifactsFolder(dataRoot, workspace);
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return [];
  }
  const items = [];
  for (const name of names.sort()) {
    if (!artifactNameSchema.safeParse(name).success) continue;
    try {
      const dir = join(folder, name);
      // lstat이라 symlink는 폴더로 세지 않는다.
      if (!(await lstat(dir)).isDirectory()) continue;
      const entry = join(dir, ARTIFACT_ENTRY);
      const info = await lstat(entry);
      if (!info.isFile()) continue;
      const handle = await open(entry, "r");
      let head: string;
      try {
        const buffer = new Uint8Array(HEAD_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
        head = new TextDecoder().decode(buffer.subarray(0, bytesRead));
      } finally {
        await handle.close();
      }
      items.push({
        name,
        ...parseArtifactMeta(head, name),
        modified: info.mtime.toISOString(),
      });
    } catch {
      continue; // 입구 file이 없거나 읽는 사이에 사라졌다.
    }
  }
  return items;
}

// `<dir>/data/` 바로 아래 일반 file만. symlink는 밖으로 가는 것의 이름·크기가 새지 않도록 건너뛴다.
async function dataEntries(dir: string): Promise<string> {
  const data = join(dir, "data");
  const entries: { name: string; size: number; modified: string }[] = [];
  try {
    // data/ 자체가 밖으로 가는 symlink면 비운다.
    if ((await realpath(data)) === data) {
      for (const name of (await readdir(data)).sort()) {
        if (name === "_entries.json") continue;
        const stat = await lstat(join(data, name));
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

/** artifact 폴더 안 file 하나의 byte. 폴더 밖(`..`, symlink로 나가는 path), 일반 file이 아닌 것, 상한 초과는 not_found다. */
export async function readArtifactFile(
  dataRoot: string,
  input: { name: string; path: string } & (
    | { project: string }
    | { app: string }
  ),
): Promise<Result<Uint8Array>> {
  const folder = artifactsFolder(dataRoot, artifactWorkspaceOf(input));
  let dir: string;
  try {
    // 폴더가 symlink면 다른 곳을 열게 되므로 lstat으로 거르고, artifacts 폴더 바로 안인지도 본다.
    if (!(await lstat(join(folder, input.name))).isDirectory()) {
      return notFound("artifact not found");
    }
    const base = await realpath(folder);
    dir = await realpath(join(folder, input.name));
    if (!dir.startsWith(base + sep)) {
      return notFound("artifact not found");
    }
  } catch {
    return notFound("artifact not found");
  }
  if (input.path === ARTIFACT_ENTRIES_PATH) {
    return ok(new TextEncoder().encode(await dataEntries(dir)));
  }
  const inside = dir + sep;
  let real: string;
  try {
    real = await realpath(join(dir, input.path));
  } catch {
    return notFound("file not found");
  }
  if (!real.startsWith(inside)) return notFound("file not found");
  let handle;
  try {
    handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return notFound("file not found");
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > ARTIFACT_FILE_MAX_BYTES) {
      return notFound("file not found");
    }
    return ok(new Uint8Array(await handle.readFile()));
  } finally {
    await handle.close();
  }
}

/** artifact 폴더 하나를 지운다. symlink 폴더와 artifacts 폴더 밖으로 나가는 경로는 거절한다. */
export async function deleteArtifactFolder(
  dataRoot: string,
  input: { name: string } & ({ project: string } | { app: string }),
): Promise<Result<null>> {
  if (!artifactNameSchema.safeParse(input.name).success) {
    return err({ code: "invalid_input", message: "invalid artifact name" });
  }
  const folder = artifactsFolder(dataRoot, artifactWorkspaceOf(input));
  const target = join(folder, input.name);
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(target);
  } catch {
    return notFound("artifact not found");
  }
  if (info.isSymbolicLink()) {
    return err({
      code: "forbidden",
      message: "artifact folder is a symbolic link",
    });
  }
  if (!info.isDirectory()) return notFound("artifact not found");
  try {
    const real = await realpath(target);
    if (!real.startsWith((await realpath(folder)) + sep)) {
      return err({
        code: "forbidden",
        message: "artifact folder is outside artifacts",
      });
    }
  } catch {
    return notFound("artifact not found");
  }
  try {
    await rm(target, { recursive: true });
  } catch {
    return err({
      code: "unavailable",
      message: "could not delete the artifact",
    });
  }
  return ok(null);
}

function authorizeArtifactDelete(
  ctx: AuthenticatedContext,
  input: { project: string } | { app: string },
): Result<void> {
  const actor = parseActor(ctx.actor);
  if (actor?.kind !== "agent") return ok(undefined);
  const boundProject = ctx.conditions?.project;
  const boundApp = ctx.conditions?.app;
  if (boundProject !== undefined) {
    if (!("project" in input) || input.project !== boundProject) {
      return err({
        code: "forbidden",
        message: "agent can only delete artifacts in its own project",
      });
    }
  } else if (boundApp !== undefined) {
    if (!("app" in input) || input.app !== boundApp) {
      return err({
        code: "forbidden",
        message: "agent can only delete artifacts in its own app",
      });
    }
  }
  return ok(undefined);
}

export function artifactHandlers(dataRoot: string): {
  list: MemoryHandler;
  file: FileStreamHandler;
  remove: MemoryHandler;
} {
  return {
    list: async (_ctx, rawInput) => {
      const input = artifactsList.input.safeParse(rawInput);
      if (!input.success) {
        return err({ code: "invalid_input", message: "invalid list input" });
      }
      return ok({
        artifacts: await listArtifacts(
          dataRoot,
          artifactWorkspaceOf(input.data),
        ),
      });
    },
    file: async (_ctx, rawInput) => {
      const input = artifactsFile.input.safeParse(rawInput);
      if (!input.success) {
        return err({ code: "invalid_input", message: "invalid file input" });
      }
      const read = await readArtifactFile(dataRoot, input.data);
      return read.ok
        ? ok(bytesFileStream(read.value, artifactsFile.output.contentType))
        : read;
    },
    remove: async (ctx, rawInput) => {
      const input = artifactsDelete.input.safeParse(rawInput);
      if (!input.success) {
        return err({ code: "invalid_input", message: "invalid delete input" });
      }
      const allowed = authorizeArtifactDelete(ctx, input.data);
      if (!allowed.ok) return allowed;
      const deleted = await deleteArtifactFolder(dataRoot, input.data);
      if (!deleted.ok) return deleted;
      return ok({
        deleted: true as const,
        follow_ups: [],
        handoff_session: null,
      });
    },
  };
}
