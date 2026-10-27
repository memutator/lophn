import { type FSWatcher, statSync, watch as watchFs } from "node:fs";
import {
  readFile as readFileNode,
  writeFile as writeFileNode,
} from "node:fs/promises";
import { resolve } from "node:path";
import { CapabilityError, forbidden } from "./errors.ts";

export type FsEvent = { kind: string; paths: string[] };

export type WatchOptions = { recursive?: boolean };

export type WriteOptions = { append?: boolean; createNew?: boolean };

export type FsWatcher = {
  // 감시를 끝낸다. 이미 받은 event는 handler까지 간다.
  close(): void;
  // 감시가 끝나면 이행한다. handler가 던지면 거절한다.
  readonly done: Promise<void>;
};

type Access = "read" | "write";

// 좁힌 권한에서 node:fs는 Deno일 때 name이 NotCapable인 오류(code 없음)를, Node일 때
// code가 ERR_ACCESS_DENIED인 오류를 낸다(실측). 둘을 같은 SDK 오류로 옮긴다.
function denied(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { name, code } = error as { name?: string; code?: string };
  return name === "NotCapable" || code === "ERR_ACCESS_DENIED";
}

// 권한 flag가 막은 접근을 permission 이름과 정확한 경로로 바꾼다. 다른 실패도 삼키지 않고
// 공통 코드로 바꾼다.
function translate(
  error: unknown,
  access: Access,
  path: string,
  recursive: boolean,
): unknown {
  if (error instanceof CapabilityError) return error;
  if (denied(error)) return forbidden(`fs.${access}`, { path, recursive });
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

async function guarded<T>(
  access: Access,
  path: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw translate(error, access, path, false);
  }
}

function absolute(path: string | URL): string {
  return resolve(path instanceof URL ? path.pathname : path);
}

export function readFile(path: string | URL): Promise<Uint8Array> {
  const target = absolute(path);
  return guarded("read", target, () => readFileNode(target));
}

export function readTextFile(path: string | URL): Promise<string> {
  const target = absolute(path);
  return guarded("read", target, () => readFileNode(target, "utf8"));
}

// SDK의 WriteOptions(append·createNew)는 node:fs에 없어 open flag로 옮긴다.
function writeFlag(options: WriteOptions): string {
  const exclusive = options.createNew ? "x" : "";
  return options.append ? `a${exclusive}` : `w${exclusive}`;
}

// fs.write grant는 fs.read를 포함하지 않는다. append·덮어쓰기 모두 write만 요구한다.
export function writeFile(
  path: string | URL,
  data: Uint8Array,
  options: WriteOptions = {},
): Promise<void> {
  const target = absolute(path);
  return guarded("write", target, () =>
    writeFileNode(target, data, { flag: writeFlag(options) }),
  );
}

export function writeTextFile(
  path: string | URL,
  text: string,
  options: WriteOptions = {},
): Promise<void> {
  const target = absolute(path);
  return guarded("write", target, () =>
    writeFileNode(target, text, { flag: writeFlag(options) }),
  );
}

type Opened = { path: string; directory: boolean; watcher: FSWatcher };

// 감시는 read 접근이다. 허락 밖 경로는 시작할 때 그 경로 이름으로 거절한다.
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
        // fs.watch는 권한이 없어도 조용히 열리고 event가 오지 않는다(Node --permission 실측).
        // stat으로 먼저 확인해 시작할 때 같은 오류를 낸다.
        const directory = statSync(path).isDirectory();
        opened.push({ path, directory, watcher: watchFs(path, { recursive }) });
      } catch (error) {
        throw translate(error, "read", path, recursive);
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
            // Deno type은 filename에 Buffer도 허용한다. string이 아닌 값은 문자열로 만든다.
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
              // for-await 순회가 끝나면 감시도 끝났다. 같은 경계를 지키게 닫고 거절한다.
              // Deno는 close가 'close' event를 그 자리에서 내므로 거절을 먼저 한다.
              reject(error);
              watcher.close();
            }
          });
          watcher.on("error", (error) =>
            reject(translate(error, "read", path, recursive)),
          );
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
