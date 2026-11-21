import { type FSWatcher, statSync, watch as watchFs } from "node:fs";
import {
  readFile as readFileNode,
  writeFile as writeFileNode,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CapabilityError } from "./errors.ts";

export type FsEvent = { kind: string; paths: string[] };

export type WatchOptions = { recursive?: boolean };

export type WriteOptions = { append?: boolean; createNew?: boolean };

export type FsWatcher = {
  // 감시를 끝낸다. 이미 받은 event는 handler까지 간다.
  close(): void;
  // 감시가 끝나면 이행한다. handler가 던지면 거절한다.
  readonly done: Promise<void>;
};

// 실패를 공통 코드로 바꾼다. 앱 process는 권한을 막지 않으므로 permission 오류를 옮길 자리는 없다.
function translate(error: unknown): unknown {
  if (error instanceof CapabilityError) return error;
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (code === "ENOENT") {
    return new CapabilityError({
      code: "not_found",
      message: "path not found",
    });
  }
  if (code === "EEXIST") {
    return new CapabilityError({
      code: "conflict",
      message: "path already exists",
    });
  }
  if (error instanceof Error) {
    return new CapabilityError({
      code: "unavailable",
      message: `${error.name}: file access failed`,
    });
  }
  return error;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw translate(error);
  }
}

// 맨 앞의 `~`·`~/`는 이 컴퓨터의 home이다. 선언의 fs 경로와 같은 글을 쓰면 한 release가 컴퓨터마다 다른 home에서 돈다.
function absolute(path: string | URL): string {
  if (path instanceof URL) return resolve(fileURLToPath(path));
  return resolve(
    path === "~" || path.startsWith("~/")
      ? join(homedir(), path.slice(1))
      : path,
  );
}

export function readFile(path: string | URL): Promise<Uint8Array> {
  const target = absolute(path);
  return guarded(() => readFileNode(target));
}

export function readTextFile(path: string | URL): Promise<string> {
  const target = absolute(path);
  return guarded(() => readFileNode(target, "utf8"));
}

// SDK의 WriteOptions(append·createNew)는 node:fs에 없어 open flag로 옮긴다.
function writeFlag(options: WriteOptions): string {
  const exclusive = options.createNew ? "x" : "";
  return options.append ? `a${exclusive}` : `w${exclusive}`;
}

export function writeFile(
  path: string | URL,
  data: Uint8Array,
  options: WriteOptions = {},
): Promise<void> {
  const target = absolute(path);
  return guarded(() =>
    writeFileNode(target, data, { flag: writeFlag(options) }),
  );
}

export function writeTextFile(
  path: string | URL,
  text: string,
  options: WriteOptions = {},
): Promise<void> {
  const target = absolute(path);
  return guarded(() =>
    writeFileNode(target, text, { flag: writeFlag(options) }),
  );
}

type Opened = { path: string; directory: boolean; watcher: FSWatcher };

export function watch(
  paths: string | readonly string[],
  handler: (event: FsEvent) => void,
  options: WatchOptions = {},
): FsWatcher {
  const list = (typeof paths === "string" ? [paths] : [...paths]).map(absolute);
  if (list.length === 0) {
    throw new CapabilityError({
      code: "invalid_input",
      message: "watch needs at least one path",
    });
  }
  const recursive = options.recursive ?? false;
  const opened: Opened[] = [];
  try {
    for (const path of list) {
      try {
        // event의 filename은 폴더를 감시할 때만 온다. 파일인지 먼저 봐 경로를 만드는 법을 정한다.
        const directory = statSync(path).isDirectory();
        opened.push({ path, directory, watcher: watchFs(path, { recursive }) });
      } catch (error) {
        throw translate(error);
      }
    }
  } catch (error) {
    for (const { watcher } of opened) watcher.close();
    throw error;
  }
  const done = Promise.all(
    opened.map(
      ({ path, directory, watcher }) =>
        new Promise<void>((settle, reject) => {
          watcher.on("change", (kind, filename) => {
            // node:fs type은 filename에 Buffer도 허용한다. string이 아닌 값은 문자열로 만든다.
            const name =
              filename === null
                ? null
                : typeof filename === "string"
                  ? filename
                  : filename.toString();
            try {
              handler({
                kind,
                paths: [
                  name === null ? path : directory ? resolve(path, name) : path,
                ],
              });
            } catch (error) {
              // handler가 던지면 감시를 닫고 done을 거절한다. close의 'close' event가 done을
              // 먼저 이행시키지 않도록 거절을 먼저 한다.
              reject(error);
              watcher.close();
            }
          });
          watcher.on("error", (error) => reject(translate(error)));
          watcher.on("close", () => settle());
        }),
    ),
  ).then(() => {});
  // 아무도 기다리지 않는 done의 거절이 unhandled rejection으로 앱을 죽이지 않게 한다.
  done.catch(() => {});
  return {
    close() {
      for (const { watcher } of opened) {
        try {
          watcher.close();
        } catch {
          // 이미 닫힌 감시다.
        }
      }
    },
    done,
  };
}
