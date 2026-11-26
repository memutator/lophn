// 터미널에 붙여 넣거나 drop한 이미지를 core 임시 폴더에 저장하고 오래된 파일을 정리한다.
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { type Clock, err, ok, type Result } from "../../base/mod.ts";

/** 터미널 이미지 붙여넣기 최대 크기(디코드 후 10 MiB). */
export const TERMINAL_PASTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** 임시 파일 보관 기간(24시간). */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** 임시 폴더에 남길 최대 파일 수. */
const MAX_FILES = 200;

export type TerminalPasteMediaType = "image/png" | "image/jpeg" | "image/webp";

const EXT_OF_MIME: Readonly<Record<TerminalPasteMediaType, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const PASTE_FILE_PATTERN = /^paste-[A-Za-z0-9_-]+\.(png|jpg|webp)$/;

function decodeBase64(raw: string, maxBytes: number): Result<Buffer> {
  const clean = raw.trim();
  if (
    clean.length === 0 ||
    clean.length % 4 !== 0 ||
    !BASE64_PATTERN.test(clean)
  ) {
    return err({ code: "invalid_input", message: "invalid base64 image data" });
  }
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const expected = (clean.length / 4) * 3 - padding;
  if (expected <= 0) {
    return err({ code: "invalid_input", message: "image data is empty" });
  }
  if (expected > maxBytes) {
    return err({
      code: "invalid_input",
      message: "image exceeds the 10 MiB limit",
    });
  }
  const buffer = Buffer.from(clean, "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) {
    return err({
      code: "invalid_input",
      message: "image exceeds the 10 MiB limit",
    });
  }
  return ok(buffer);
}

async function pruneOldFiles(dir: string, nowMs: number): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const entries: { path: string; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!PASTE_FILE_PATTERN.test(name)) continue;
    const full = join(dir, name);
    try {
      const info = await lstat(full);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      if (nowMs - info.mtimeMs > MAX_AGE_MS) {
        await unlink(full).catch(() => {});
      } else {
        entries.push({ path: full, mtimeMs: info.mtimeMs });
      }
    } catch {
      // 그 사이 지워졌거나 읽지 못한 파일은 건너뛴다.
    }
  }
  if (entries.length > MAX_FILES) {
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const old of entries.slice(MAX_FILES)) {
      await unlink(old.path).catch(() => {});
    }
  }
}

export async function saveTerminalPasteImage(
  deps: {
    dir: string;
    clock: Clock;
    random?: (bytes: number) => Uint8Array;
  },
  input: {
    media_type: TerminalPasteMediaType;
    data_base64: string;
  },
): Promise<Result<{ path: string; bytes: number }>> {
  const ext = EXT_OF_MIME[input.media_type];
  if (ext === undefined) {
    return err({ code: "invalid_input", message: "unsupported image type" });
  }
  const decoded = decodeBase64(
    input.data_base64,
    TERMINAL_PASTE_IMAGE_MAX_BYTES,
  );
  if (!decoded.ok) return decoded;

  const bytes = decoded.value;
  try {
    await mkdir(deps.dir, { recursive: true, mode: 0o700 });
  } catch {
    return err({
      code: "unavailable",
      message: "failed to prepare temporary image directory",
    });
  }

  const nowMs = deps.clock.nowMs();
  const token = Buffer.from(
    (deps.random ?? ((n) => randomBytes(n)))(6),
  ).toString("hex");
  const filePath = join(deps.dir, `paste-${nowMs}-${token}.${ext}`);

  try {
    const handle = await open(
      filePath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
  } catch {
    return err({
      code: "unavailable",
      message: "failed to save pasted image",
    });
  }

  // 오래된 임시 파일 정리는 저장 성공 뒤 조용히 돌린다.
  await pruneOldFiles(deps.dir, nowMs);
  return ok({ path: filePath, bytes: bytes.byteLength });
}
