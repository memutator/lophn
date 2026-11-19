// 전역 지침(`<data root>/LOPHN.md`)을 읽고 쓰는 core memory handler.
// Settings › Agents가 이 컴퓨터와 다른 컴퓨터 모두 이 통로로 읽고 쓰며, hash 비교(base_hash)로 충돌을 잡는다.
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  err,
  errorCode,
  ok,
  type RandomSource,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  GLOBAL_INSTRUCTIONS_MAX_BYTES,
  INSTRUCTION_FILE_NAMES,
} from "../../../protocol/lophn-agent/mod.ts";

const GLOBAL_FILE = INSTRUCTION_FILE_NAMES[0];
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

function decodeUtf8(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

function randomHex(random: RandomSource, byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  random.fill(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function readOrNull(path: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT") return null;
    throw thrown;
  }
}

export function createGlobalInstructionsHandlers(
  dataRoot: string,
  random: RandomSource,
) {
  const path = join(dataRoot, GLOBAL_FILE);
  // 같은 파일의 쓰기를 한 줄로 세워 base_hash 비교와 임시 파일 교체 사이에 다른 쓰기가 끼지 않게 한다.
  let queue: Promise<unknown> = Promise.resolve();

  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  }

  async function read(): Promise<
    Result<{ text: string; hash: string | null }>
  > {
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(path);
    } catch (thrown) {
      if (errorCode(thrown) === "ENOENT") {
        return ok({ text: "", hash: null });
      }
      return err({
        code: "unavailable",
        message: "could not read global instructions",
      });
    }
    if (!info.isFile() || info.size > GLOBAL_INSTRUCTIONS_MAX_BYTES) {
      return err({
        code: "unavailable",
        message: "global instructions file is unreadable or too large",
      });
    }
    try {
      const bytes = new Uint8Array(await readFile(path));
      const text = decodeUtf8(bytes);
      if (text === null) {
        return err({
          code: "unavailable",
          message: "global instructions file is not valid UTF-8",
        });
      }
      return ok({ text, hash: await sha256Hex(bytes) });
    } catch {
      return err({
        code: "unavailable",
        message: "could not read global instructions",
      });
    }
  }

  function write(input: {
    text: string;
    base_hash: string | null;
  }): Promise<Result<{ hash: string }>> {
    const bytes = encoder.encode(input.text);
    if (bytes.byteLength > GLOBAL_INSTRUCTIONS_MAX_BYTES) {
      return Promise.resolve(
        err({
          code: "invalid_input",
          message: `global instructions exceed ${GLOBAL_INSTRUCTIONS_MAX_BYTES} bytes`,
        }),
      );
    }
    return serial(async () => {
      let current: Uint8Array | null;
      try {
        current = await readOrNull(path);
      } catch {
        return err({
          code: "unavailable",
          message: "could not read global instructions",
        });
      }
      const currentHash = current === null ? null : await sha256Hex(current);
      if (currentHash !== input.base_hash) {
        return err({
          code: "conflict",
          message: "global instructions changed on disk",
        });
      }
      const mode =
        current === null
          ? 0o644
          : await stat(path)
              .then((info) => info.mode & 0o777)
              .catch(() => 0o644);
      const temp = join(
        dataRoot,
        `.${GLOBAL_FILE}.lophn-${randomHex(random, 6)}.tmp`,
      );
      try {
        const handle = await open(temp, "wx", mode);
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temp, path);
      } catch {
        await rm(temp, { force: true }).catch(() => {});
        return err({
          code: "unavailable",
          message: "could not write global instructions",
        });
      }
      return ok({ hash: await sha256Hex(bytes) });
    });
  }

  return { read, write };
}
