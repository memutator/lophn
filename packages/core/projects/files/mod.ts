import { open, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ProjectFileEntry,
  projectFilesList,
  projectFilesRead,
} from "../../../protocol/projects/mod.ts";
import type { ApiReadDefinition, Sql } from "../../../protocol/server/mod.ts";
import { loadProject, symlinkEscapesRoot } from "../registry/mod.ts";
import { decodeText } from "../search/model.ts";

type ProjectFilesDeps = {
  // ledger snapshot 하나에서 project를 읽는다. 연결은 읽고 나면 닫는다.
  snapshot<T>(
    read: (sql: Pick<Sql, "get" | "all">, asOfSeq: string) => Result<T>,
  ): Result<T>;
};

const MAX_READ_BYTES = 1024 * 1024;
const HIDDEN = new Set([".git", "node_modules"]);

const notFound = (message: string): Result<never> =>
  err({ code: "not_found", message });
const invalid = (message: string): Result<never> =>
  err({ code: "invalid_input", message });

// project의 등록 폴더 하나의 realpath를 찾는다.
async function rootOf(
  deps: ProjectFilesDeps,
  input: { project: string; folder?: string | undefined },
): Promise<Result<{ root: string }>> {
  const loaded = deps.snapshot((sql) => loadProject(sql, input.project));
  if (!loaded.ok) return loaded;
  const project = loaded.value;
  if (project === null) return notFound("project not found");
  const folder =
    input.folder === undefined
      ? project.folders[0]
      : project.folders.find((item) => item.path === input.folder);
  if (folder === undefined) {
    return invalid("folder is not a connected folder of the project");
  }
  try {
    return ok({ root: await realpath(folder.path) });
  } catch {
    return notFound("folder not found");
  }
}

// root 아래 path의 실제 경로. symlink를 따라간 끝이 root 밖이면 거절한다.
async function within(
  root: string,
  path: string | undefined,
): Promise<Result<string>> {
  try {
    const real = await realpath(path === undefined ? root : join(root, path));
    const escapes = symlinkEscapesRoot(root, real);
    if (!escapes.ok) return escapes;
    return escapes.value
      ? invalid("path is outside the connected folder")
      : ok(real);
  } catch {
    return notFound("path not found");
  }
}

export function projectFilesListRead(
  deps: ProjectFilesDeps,
): ApiReadDefinition<typeof projectFilesList> {
  return {
    route: projectFilesList,
    async handle(_ctx, input) {
      const parsed = projectFilesList.input.safeParse(input);
      if (!parsed.success) return invalid("invalid read input");
      const found = await rootOf(deps, parsed.data);
      if (!found.ok) return found;
      const { root } = found.value;
      const real = await within(root, parsed.data.path);
      if (!real.ok) return real;
      if (!(await stat(real.value)).isDirectory())
        return invalid("not a folder");
      const entries: ProjectFileEntry[] = [];
      for (const name of await readdir(real.value)) {
        if (HIDDEN.has(name)) continue;
        // 깨진 symlink와 도는 동안 사라진 항목은 건너뛴다. 밖을 가리키는 symlink는 보이지 않는다.
        const base = parsed.data.path;
        const entry = await within(
          root,
          base === undefined ? name : `${base}/${name}`,
        );
        if (!entry.ok) continue;
        const info = await stat(entry.value).catch(() => null);
        if (info === null) continue;
        const folder = info.isDirectory();
        if (!folder && !info.isFile()) continue;
        entries.push({
          name,
          kind: folder ? "folder" : "file",
          size: folder ? 0 : info.size,
          modified_at: info.mtime.toISOString(),
        });
      }
      entries.sort((a, b) =>
        a.kind !== b.kind
          ? a.kind === "folder"
            ? -1
            : 1
          : a.name < b.name
            ? -1
            : a.name > b.name
              ? 1
              : 0,
      );
      return ok({ entries });
    },
  };
}

export function projectFilesReadRead(
  deps: ProjectFilesDeps,
): ApiReadDefinition<typeof projectFilesRead> {
  return {
    route: projectFilesRead,
    async handle(_ctx, input) {
      const parsed = projectFilesRead.input.safeParse(input);
      if (!parsed.success) return invalid("invalid read input");
      const found = await rootOf(deps, parsed.data);
      if (!found.ok) return found;
      const { root } = found.value;
      const real = await within(root, parsed.data.path);
      if (!real.ok) return real;
      if (!(await stat(real.value)).isFile()) return invalid("not a file");
      // 한 byte 더 읽어 넘는지 안다.
      const handle = await open(real.value, "r");
      let bytes: Uint8Array;
      try {
        const buffer = new Uint8Array(MAX_READ_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        bytes = buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
      const truncated = bytes.length > MAX_READ_BYTES;
      if (truncated) {
        // 잘린 자리가 UTF-8 글자 한가운데면 그 글자 앞에서 끊는다.
        let cut = MAX_READ_BYTES;
        while (cut > 0 && (bytes[cut]! & 0xc0) === 0x80) cut--;
        bytes = bytes.subarray(0, cut);
      }
      const text = decodeText(bytes);
      if (text === null) return invalid("not a UTF-8 text file");
      return ok({ text, truncated });
    },
  };
}
