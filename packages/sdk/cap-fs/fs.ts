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

// Deno flag가 막은 접근을 permission 이름과 정확한 경로로 바꾼다. 다른 실패도 삼키지 않고
// 공통 코드로 바꾼다.
function translate(
  error: unknown,
  access: Access,
  path: string,
  recursive: boolean,
): unknown {
  if (error instanceof CapabilityError) return error;
  if (error instanceof Deno.errors.NotCapable) {
    return forbidden(`fs.${access}`, { path, recursive });
  }
  if (error instanceof Deno.errors.NotFound) {
    return new CapabilityError({
      code: "not_found",
      message: "path not found",
    });
  }
  if (error instanceof Deno.errors.AlreadyExists) {
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
  return guarded("read", target, () => Deno.readFile(target));
}

export function readTextFile(path: string | URL): Promise<string> {
  const target = absolute(path);
  return guarded("read", target, () => Deno.readTextFile(target));
}

// fs.write grant는 fs.read를 포함하지 않는다. append·덮어쓰기 모두 write만 요구한다.
export function writeFile(
  path: string | URL,
  data: Uint8Array,
  options: WriteOptions = {},
): Promise<void> {
  const target = absolute(path);
  return guarded("write", target, () => Deno.writeFile(target, data, options));
}

export function writeTextFile(
  path: string | URL,
  text: string,
  options: WriteOptions = {},
): Promise<void> {
  const target = absolute(path);
  return guarded("write", target, () =>
    Deno.writeTextFile(target, text, options),
  );
}

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
  const opened: Deno.FsWatcher[] = [];
  try {
    for (const path of list) {
      try {
        opened.push(Deno.watchFs(path, { recursive }));
      } catch (error) {
        throw translate(error, "read", path, recursive);
      }
    }
  } catch (error) {
    for (const watcher of opened) watcher.close();
    throw error;
  }
  const done = Promise.all(
    opened.map(async (watcher, index) => {
      try {
        for await (const event of watcher) {
          handler({ kind: event.kind, paths: event.paths });
        }
      } catch (error) {
        if (error instanceof Deno.errors.BadResource) return;
        throw translate(error, "read", list[index], recursive);
      }
    }),
  ).then(() => {});
  // 아무도 기다리지 않는 done의 거절이 unhandled rejection으로 앱을 죽이지 않게 한다.
  done.catch(() => {});
  return {
    close() {
      for (const watcher of opened) {
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
