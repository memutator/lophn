// Node entry의 앱 file이다. 자기 data 영역의 `files/`를 직접 읽고 쓴다. 자리 규칙은 core의 `apps/app-files/store.ts`와 같다:
//   files/<sha256 앞 두 글자>/<sha256>        bytes
//   files/<sha256 앞 두 글자>/<sha256>.json   sidecar `{type, size, name?}`. 이것이 있어야 있는 file이다
//   files/_staging/                          쓰는 중인 file
// 임시 이름으로 쓰고 rename하므로 core가 같은 file을 같이 받아도 서로 깨지 않는다. 지우는 길은 없다.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CapabilityError } from "./errors.ts";
import {
  APP_FILE_HASH,
  APP_FILE_MAX_BYTES,
  APP_FILE_NAME_MAX_CHARS,
  APP_FILE_TYPE_MAX_CHARS,
  type AppFileHandle,
  type AppFileMeta,
  type AppFileOptions,
} from "./files.ts";
import { readHost } from "./host.ts";

function invalid(message: string): CapabilityError {
  return new CapabilityError({ code: "invalid_input", message });
}

function area(options: AppFileOptions): string {
  if (options.dataPath !== undefined) return resolve(options.dataPath);
  const host = readHost();
  if (!host) {
    throw new CapabilityError({
      code: "unavailable",
      message: "this code is not running inside a lophn app process",
    });
  }
  return resolve(host.dataPath);
}

function hashOf(file: string | { file: string }): string {
  const hash = typeof file === "string" ? file : file.file;
  if (typeof hash !== "string" || !APP_FILE_HASH.test(hash)) {
    throw invalid("a file is named by its lowercase hex sha256");
  }
  return hash;
}

const blobOf = (dataArea: string, hash: string) =>
  `${dataArea}/files/${hash.slice(0, 2)}/${hash}`;

async function sizeOf(blob: string): Promise<number | null> {
  try {
    const meta = JSON.parse(await readFile(`${blob}.json`, "utf8")) as {
      size?: unknown;
    };
    return typeof meta.size === "number" ? meta.size : null;
  } catch {
    return null;
  }
}

// bytes를 file로 넣고 handle을 돌려준다. 이미 있는 file이면 아무것도 쓰지 않는다.
export async function putAppFile(
  bytes: Uint8Array,
  meta: AppFileMeta,
  options: AppFileOptions = {},
): Promise<AppFileHandle> {
  if (bytes.byteLength > APP_FILE_MAX_BYTES) {
    throw invalid(`a file is at most ${APP_FILE_MAX_BYTES} bytes`);
  }
  if (
    typeof meta.type !== "string" ||
    meta.type.length === 0 ||
    meta.type.length > APP_FILE_TYPE_MAX_CHARS
  ) {
    throw invalid(
      `type is a content type of 1 to ${APP_FILE_TYPE_MAX_CHARS} characters`,
    );
  }
  if (meta.name !== undefined && meta.name.length > APP_FILE_NAME_MAX_CHARS) {
    throw invalid(`name is at most ${APP_FILE_NAME_MAX_CHARS} characters`);
  }
  const dataArea = area(options);
  const file = createHash("sha256").update(bytes).digest("hex");
  const handle: AppFileHandle = {
    file,
    type: meta.type,
    size: bytes.byteLength,
    ...(meta.name === undefined ? {} : { name: meta.name }),
  };
  const blob = blobOf(dataArea, file);
  if ((await sizeOf(blob)) !== null) return handle;
  const staging = `${dataArea}/files/_staging`;
  await mkdir(staging, { recursive: true, mode: 0o700 });
  await mkdir(`${dataArea}/files/${file.slice(0, 2)}`, {
    recursive: true,
    mode: 0o700,
  });
  const temp = `${staging}/${file}.${randomUUID()}`;
  await writeFile(temp, bytes, { mode: 0o600 });
  await rename(temp, blob);
  await writeFile(
    `${temp}.json`,
    JSON.stringify({
      type: meta.type,
      size: bytes.byteLength,
      ...(meta.name === undefined ? {} : { name: meta.name }),
    }),
    { mode: 0o600 },
  );
  await rename(`${temp}.json`, `${blob}.json`);
  return handle;
}

// handle이나 sha256으로 file의 bytes를 읽는다. 없으면 `not_found`다.
export async function readAppFile(
  file: string | { file: string },
  options: AppFileOptions = {},
): Promise<Uint8Array> {
  const blob = blobOf(area(options), hashOf(file));
  if ((await sizeOf(blob)) === null) {
    throw new CapabilityError({ code: "not_found", message: "file not found" });
  }
  return new Uint8Array(await readFile(blob));
}

export async function hasAppFile(
  file: string | { file: string },
  options: AppFileOptions = {},
): Promise<boolean> {
  return (await sizeOf(blobOf(area(options), hashOf(file)))) !== null;
}
