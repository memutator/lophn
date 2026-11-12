import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile as writeNodeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  errorCode,
  type IdSource,
  ok,
  type Result,
} from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import type { FileHooks } from "../ports.ts";
import type { ToolContext } from "../tool-context.ts";
import { fail, fsFail, resolveInWorkspace } from "./scope.ts";

// 읽기 상한(read.ts의 MAX_FILE_BYTES)과 같은 값이다.
const MAX_WRITE_BYTES = 10 * 1024 * 1024;
const BOM = [0xef, 0xbb, 0xbf];

const tooBig = (bytes: number) =>
  fail(
    "invalid_input",
    `the file would be ${bytes} bytes, over the 10 MiB limit of file tools`,
  );

// 같은 폴더의 temp에 쓰고 rename으로 바꾼다. 쓰다 죽거나 disk가 차도 원래 file은 온전하다.
// rename이 막혀도(Windows의 열린 file) 그 자리 쓰기로 돌아가지 않는다: 반쯤 쓴 file이 남는다.
export async function replaceFile(
  path: string,
  bytes: Uint8Array,
  ids: IdSource,
): Promise<void> {
  const temp = join(
    dirname(path),
    `.${basename(path)}.${ids.newId("tmp")}.tmp`,
  );
  try {
    await writeNodeFile(temp, bytes);
    const old = await stat(path).catch(() => null);
    if (old !== null) await chmod(temp, old.mode & 0o7777);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

// 옛 file을 BOM과 글로 나눈다. UTF-8 글이 아니면 null이다.
function decodeOld(bytes: Uint8Array): { bom: boolean; text: string } | null {
  if (bytes.includes(0)) return null;
  try {
    return {
      bom: BOM.every((byte, i) => bytes[i] === byte),
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return null;
  }
}

// 모든 \n 앞에 \r가 있는 file만 CRLF file이다. 섞인 file은 글자 그대로 다룬다.
const isCrlf = (text: string) =>
  text.includes("\r\n") && !/(^|[^\r])\n/.test(text);

// 쓰기는 hook이 감싼다(workspace 층이 쓰기 기록을 남긴다).
async function writeText(
  ctx: ToolContext,
  hooks: FileHooks,
  inputPath: string,
  content: string,
  edit: { old_string: string; new_string: string; all: boolean } | null,
): Promise<Result<ToolResult>> {
  const at = await resolveInWorkspace(ctx.scope, inputPath, "write");
  if (!at.ok) return at;
  const target = at.value;
  let exists = false;
  let old: Uint8Array | null = null;
  try {
    const info = await stat(target.path);
    exists = true;
    if (info.size <= MAX_WRITE_BYTES) old = await readFile(target.path);
    else if (edit !== null) return tooBig(info.size);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") return fsFail(error);
  }
  const decoded = old === null ? null : decodeOld(old);

  let next = content;
  let replaced = 0;
  if (edit !== null) {
    if (!exists) return fail("not_found", "file not found");
    if (decoded === null) {
      return fail(
        "invalid_input",
        "not a UTF-8 text file; file.edit only changes UTF-8 text",
      );
    }
    if (edit.old_string === "" || edit.old_string === edit.new_string) {
      return fail(
        "invalid_input",
        "old_string is empty or the same as new_string",
      );
    }
    const crlf = isCrlf(decoded.text);
    const lf = (text: string) => (crlf ? text.replaceAll("\r\n", "\n") : text);
    const oldString = lf(edit.old_string);
    const newString = lf(edit.new_string);
    const parts = lf(decoded.text).split(oldString);
    replaced = parts.length - 1;
    if (replaced === 0) return fail("invalid_input", "old_string not found");
    if (replaced > 1 && !edit.all) {
      return fail(
        "invalid_input",
        `old_string appears ${replaced} times; add context or use replace_all`,
      );
    }
    next = edit.all
      ? parts.join(newString)
      : parts[0] + newString + parts.slice(1).join(oldString);
    if (crlf) next = next.replaceAll("\n", "\r\n");
    if (!edit.all) replaced = 1;
  } else if (
    decoded !== null &&
    isCrlf(decoded.text) &&
    !content.includes("\r\n")
  ) {
    next = content.replaceAll("\n", "\r\n");
  }

  const text = new TextEncoder().encode(next);
  const keepBom = decoded?.bom === true && !next.startsWith("\uFEFF");
  const bytes = new Uint8Array(text.length + (keepBom ? BOM.length : 0));
  if (keepBom) bytes.set(BOM);
  bytes.set(text, keepBom ? BOM.length : 0);
  if (bytes.length > MAX_WRITE_BYTES) return tooBig(bytes.length);

  const written = await hooks.aroundWrite(ctx, target, async () => {
    try {
      const parent = dirname(target.path);
      if (
        !(await stat(parent).then(
          () => true,
          () => false,
        ))
      ) {
        await mkdir(parent, { recursive: true });
      }
      await replaceFile(target.path, bytes, ctx.ids);
      return ok(undefined);
    } catch (error) {
      return fsFail(error);
    }
  });
  if (!written.ok) return written;
  return ok({
    status: "success",
    summary:
      edit === null
        ? `${exists ? "wrote" : "created"} ${inputPath}`
        : `edited ${inputPath} (${replaced} replaced)`,
    content: {
      path: inputPath,
      created: !exists,
      bytes: bytes.length,
    },
    complete: true,
    source: null,
    continuation: null,
    pending: [],
  });
}

export function writeFile(
  input: { path: string; content: string },
  ctx: ToolContext,
  hooks: FileHooks,
): Promise<Result<ToolResult>> {
  return writeText(ctx, hooks, input.path, input.content, null);
}

export function editFile(
  input: {
    path: string;
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  },
  ctx: ToolContext,
  hooks: FileHooks,
): Promise<Result<ToolResult>> {
  return writeText(ctx, hooks, input.path, "", {
    old_string: input.old_string,
    new_string: input.new_string,
    all: input.replace_all === true,
  });
}
