// 앱 file(바뀌지 않는 bytes, 이름은 sha256)의 자리 규칙과 읽기·쓰기. core에서 이 layout을 만지는 곳은 여기뿐이다.
// 자리는 앱 data 영역 안 `files/`다(운영은 `<data root>/apps/<app>/data/`, preview는 그 영역):
//   files/<sha256 앞 두 글자>/<sha256>        bytes
//   files/<sha256 앞 두 글자>/<sha256>.json   sidecar `{type, size, name?}`. 이것이 있어야 있는 file이다
//   files/_staging/                          끝나지 않은 조각과 쓰는 중인 file(이름이 hash와 겹치지 않는다)
// file은 staging에서 sha256과 크기를 확인한 뒤 rename으로 놓고 다시 쓰지 않는다. 앱 process의 SDK(`@lophn/cap-store`)도 같은
// 규칙으로 같은 폴더에 쓴다: 이 규칙을 바꾸면 그쪽 사본과 `packages/core/apps/app-files/parity_test.ts`도 바꾼다.
// 지우는 길이 없다: 앱을 지울 때 앱 폴더와 함께 없어진다.
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { createReadStream } from "node:fs";
import {
  appendFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  type Clock,
  err,
  errorCode,
  ok,
  type Result,
} from "../../../base/mod.ts";
import {
  APP_FILE_HASH,
  APP_FILE_SAMPLES,
} from "../../../protocol/apps/app-file-values.ts";

const STAGING = "_staging";
// 끝나지 않은 조각을 이만큼 지나면 다음 put이 지운다(timer와 job이 없다).
const APP_FILE_STAGING_KEEP_MS = 60 * 60 * 1000;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export type AppFileMeta = { type: string; size: number; name?: string };

type PutPiece = {
  file: string;
  size: number;
  type: string;
  name?: string;
  offset: number;
  bytes: Uint8Array;
};

export type AppFileStore = {
  put(
    area: string,
    piece: PutPiece,
  ): Promise<
    Result<{ status: "stored" | "partial" | "have"; received: number }>
  >;
  read(
    area: string,
    file: string,
    offset: number,
    length: number,
  ): Promise<Result<{ meta: AppFileMeta; bytes: Uint8Array }>>;
};

const notFound = () =>
  err({ code: "not_found" as const, message: "file not found" });

// 이름을 받는 입구(put, read)가 경로를 만들기 전에 hash가 아닌 이름을 막는다(route의 schema에 기대지 않는다).
const badName = () =>
  err({
    code: "invalid_input" as const,
    message: "a file is named by its lowercase hex sha256",
  });

const blobPath = (area: string, file: string) =>
  `${area}/files/${file.slice(0, 2)}/${file}`;

async function readMeta(blob: string): Promise<AppFileMeta | null> {
  try {
    return JSON.parse(await readFile(`${blob}.json`, "utf8")) as AppFileMeta;
  } catch {
    return null;
  }
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

// staging의 완성한 file을 확인하고 놓는다. 맞지 않으면 버리고 알린다.
async function place(
  area: string,
  staged: string,
  piece: Pick<PutPiece, "file" | "size" | "type" | "name">,
): Promise<Result<void>> {
  const wrong =
    (await stat(staged)).size !== piece.size ||
    (await sha256Of(staged)) !== piece.file;
  if (wrong) {
    await rm(staged, { force: true });
    return err({
      code: "invalid_input",
      message: "the file does not match its sha256 or size",
      details: { received: 0, reason: "mismatch" },
    });
  }
  const blob = blobPath(area, piece.file);
  await mkdir(`${area}/files/${piece.file.slice(0, 2)}`, {
    recursive: true,
    mode: DIRECTORY_MODE,
  });
  await rename(staged, blob);
  const meta: AppFileMeta = {
    type: piece.type,
    size: piece.size,
    ...(piece.name === undefined ? {} : { name: piece.name }),
  };
  const sidecar = `${staged}.json`;
  await writeFile(sidecar, JSON.stringify(meta), { mode: FILE_MODE });
  await rename(sidecar, `${blob}.json`);
  return ok(undefined);
}

/** 영역을 만들 때 부른다: `files/`를 만들고 sample 둘을 둔다. preview의 data 영역이 이 file을 가져 읽는 쪽에 특별한 갈래가 없다. */
export async function seedAppFiles(area: string): Promise<void> {
  await mkdir(`${area}/files/${STAGING}`, {
    recursive: true,
    mode: DIRECTORY_MODE,
  });
  for (const sample of APP_FILE_SAMPLES) {
    const { handle } = sample;
    const part = `${area}/files/${STAGING}/${handle.file}.part`;
    await writeFile(part, Buffer.from(sample.bytes_base64, "base64"), {
      mode: FILE_MODE,
    });
    const placed = await place(area, part, {
      file: handle.file,
      size: handle.size,
      type: handle.type,
      name: handle.name,
    });
    if (!placed.ok) throw new Error(placed.error.message);
  }
}

export function createAppFileStore(deps: { clock: Clock }): AppFileStore {
  // 같은 (영역, file)의 조각은 하나씩 잇는다(carry/put과 같다).
  const lanes = new Map<string, Promise<unknown>>();
  function oneAtATime<T>(key: string, work: () => Promise<T>): Promise<T> {
    const next = (lanes.get(key) ?? Promise.resolve()).then(work);
    const settled = next.catch(() => undefined);
    lanes.set(key, settled);
    void settled.then(() => {
      if (lanes.get(key) === settled) lanes.delete(key);
    });
    return next;
  }

  async function sweep(staging: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(staging);
    } catch {
      return;
    }
    const cutoff = deps.clock.nowMs() - APP_FILE_STAGING_KEEP_MS;
    for (const name of names) {
      try {
        if ((await stat(`${staging}/${name}`)).mtimeMs < cutoff) {
          await rm(`${staging}/${name}`, { force: true });
        }
      } catch {
        // 사이에 끝났다.
      }
    }
  }

  async function putPiece(area: string, piece: PutPiece) {
    const blob = blobPath(area, piece.file);
    const held = await readMeta(blob);
    if (held !== null) {
      return ok({ status: "have" as const, received: held.size });
    }
    const staging = `${area}/files/${STAGING}`;
    await mkdir(staging, { recursive: true, mode: DIRECTORY_MODE });
    await sweep(staging);
    const part = `${staging}/${piece.file}.part`;
    let received: number;
    try {
      received = (await stat(part)).size;
    } catch {
      received = 0;
    }
    // 빈 조각은 묻기다: 아무것도 쓰지 않고 지금 쥔 bytes를 답한다(보내기 전에 컴퓨터가 이미 가졌는지 본다).
    if (piece.bytes.byteLength === 0 && piece.size > 0) {
      return ok({ status: "partial" as const, received });
    }
    if (piece.offset !== received) {
      return err({
        code: "invalid_input" as const,
        message: `offset ${piece.offset} does not continue the ${received} bytes held; resume at offset ${received}`,
        details: { received },
      });
    }
    const total = piece.offset + piece.bytes.byteLength;
    if (total > piece.size) {
      await rm(part, { force: true });
      return err({
        code: "invalid_input" as const,
        message:
          "the piece goes past the size of the file; start again at offset 0",
        details: { received: 0 },
      });
    }
    if (piece.offset === 0) {
      await writeFile(part, piece.bytes, { mode: FILE_MODE });
    } else {
      await appendFile(part, piece.bytes);
    }
    if (total < piece.size)
      return ok({ status: "partial" as const, received: total });
    const placed = await place(area, part, piece);
    if (!placed.ok) return placed;
    return ok({ status: "stored" as const, received: total });
  }

  return {
    put(area, piece) {
      if (!APP_FILE_HASH.test(piece.file)) return Promise.resolve(badName());
      return oneAtATime(`${area}\n${piece.file}`, async () => {
        try {
          return await putPiece(area, piece);
        } catch (thrown) {
          return err({
            code: "unavailable",
            message: `app file could not be written (${errorCode(thrown) ?? "io"})`,
          });
        }
      });
    },
    async read(area, file, offset, length) {
      if (!APP_FILE_HASH.test(file)) return badName();
      const blob = blobPath(area, file);
      const meta = await readMeta(blob);
      if (meta === null) return notFound();
      let handle;
      try {
        handle = await open(blob, "r");
      } catch {
        return notFound();
      }
      try {
        const buffer = Buffer.alloc(
          Math.max(0, Math.min(length, meta.size - offset)),
        );
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          offset,
        );
        return ok({ meta, bytes: buffer.subarray(0, bytesRead) });
      } finally {
        await handle.close();
      }
    },
  };
}
