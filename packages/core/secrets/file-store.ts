// `<data root>/secrets.json`(0600): 이름 → 값(문자열)의 평평한 JSON 객체 하나다. core가 직접 읽고 쓴다.
//
// 지키는 것:
// - 쓰기는 같은 폴더의 임시 파일에 0600으로 전체를 만들어 fsync한 뒤 rename한다. 실패하면 임시 파일을
//   지우고 이전 파일과 메모리 사본이 그대로다. 끝난 뒤 새로 시작하는 사용은 이전 값을 읽지 않는다.
// - 시작할 때 mode가 0600보다 넓으면 0600으로 고친다. 고치지 못하면 파일을 읽지 않고 unavailable이다.
// - 읽거나 쓸 수 없으면 secret이 필요한 기능만 고정 문장 이유와 함께 unavailable이다. 환경 변수·다른 파일
//   fallback은 없다.
// - 반환 오류·log에는 고정 문장만 있다. 값도 경로도 싣지 않는다(예외의 message도 옮기지 않는다).
import { err, ok, type Result } from "../../base/mod.ts";
import {
  SECRET_FILE_NAME,
  SECRET_INPUT_MAX_BYTES,
  type SecretFileStatus,
  secretNameSchema,
} from "../../protocol/secrets/mod.ts";

export { SECRET_FILE_NAME };

export const SECRET_FILE_MODE = 0o600;

// fs 접근. test가 쓰기 실패를 끼운다. 없는 파일은 Deno.errors.NotFound를 던진다.
export type SecretFs = {
  readText(path: string): Promise<string>;
  mode(path: string): Promise<number>;
  chmod(path: string, mode: number): Promise<void>;
  // 새 파일을 mode로 만들어 전체를 쓰고 fsync한다. 이미 있으면 지우고 만든다.
  writeNew(path: string, text: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
};

export const denoSecretFs: SecretFs = {
  readText: (path) => Deno.readTextFile(path),
  async mode(path) {
    return (await Deno.stat(path)).mode ?? SECRET_FILE_MODE;
  },
  chmod: (path, mode) => Deno.chmod(path, mode),
  async writeNew(path, text, mode) {
    await Deno.remove(path).catch(() => {});
    const file = await Deno.open(path, { write: true, createNew: true, mode });
    try {
      await file.write(new TextEncoder().encode(text));
      await file.syncData();
    } finally {
      file.close();
    }
  },
  rename: (from, to) => Deno.rename(from, to),
  remove: (path) => Deno.remove(path),
};

export type SecretFileStore = {
  // 파일을 읽어 사본을 맞춘다. 파일이 없으면 빈 저장소다. 실패하면 이유가 고정 문장인 unavailable이다.
  open(): Promise<Result<void>>;
  // 이름 순서. unavailable이면 err다.
  names(): Result<string[]>;
  // 없으면 not_found, 읽을 수 없으면 unavailable.
  get(name: string): Result<string>;
  // 지금 사본의 모든 값. 알려진 값 등록이 읽는다.
  values(): Result<string[]>;
  put(name: string, value: string): Promise<Result<SecretFileStatus>>;
  // 없는 이름은 오류가 아니라 configured: false다.
  delete(name: string): Promise<Result<SecretFileStatus>>;
  // 사본을 비운다.
  stop(): void;
};

const UNAVAILABLE_READ = "secret 파일을 읽을 수 없다";
const UNAVAILABLE_FORMAT = "secret 파일 모양이 맞지 않는다";
const UNAVAILABLE_MODE = "secret 파일 권한을 고치지 못했다";
const UNAVAILABLE_WRITE = "secret 파일을 쓰지 못했다";
const UNAVAILABLE_STOPPED = "secret 저장소가 닫혔다";

const unavailable = (message: string) =>
  err({ code: "unavailable" as const, message });

export function createSecretFileStore(options: {
  // data root 폴더. 파일은 `<root>/secrets.json`이다.
  root: string;
  fs?: SecretFs;
  // 값 없는 안전한 log. 고정 문장만 받는다.
  log?: (message: string) => void;
}): SecretFileStore {
  const fs = options.fs ?? denoSecretFs;
  const log = options.log ?? (() => {});
  const path = `${options.root}/${SECRET_FILE_NAME}`;
  const temp = `${path}.tmp`;
  let copy: Map<string, string> | undefined;
  // 열 수 없는 이유. 있으면 secret 기능은 unavailable이고, 다음 호출이 다시 연다.
  let failure: string | undefined = UNAVAILABLE_READ;
  let stopped = false;
  // put·delete·open은 한 번에 하나씩 돈다.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  };

  async function load(): Promise<Result<void>> {
    if (stopped) return unavailable(UNAVAILABLE_STOPPED);
    let text: string;
    try {
      const mode = await fs.mode(path);
      if ((mode & 0o177) !== 0) {
        try {
          await fs.chmod(path, SECRET_FILE_MODE);
          log("secret 파일 권한을 0600으로 고쳤다");
        } catch {
          log("secret 파일 권한을 고치지 못했다");
          failure = UNAVAILABLE_MODE;
          return unavailable(failure);
        }
      }
      text = await fs.readText(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        copy = new Map();
        failure = undefined;
        return ok(undefined);
      }
      log("secret 파일을 읽지 못했다");
      failure = UNAVAILABLE_READ;
      return unavailable(failure);
    }
    const parsed = parse(text);
    if (parsed === undefined) {
      log("secret 파일 모양이 맞지 않는다");
      failure = UNAVAILABLE_FORMAT;
      return unavailable(failure);
    }
    copy = parsed;
    failure = undefined;
    return ok(undefined);
  }

  // 이미 열렸으면 그대로 쓰고, 열리지 않은 상태면 다시 연다.
  async function ready(): Promise<Result<Map<string, string>>> {
    if (failure !== undefined || copy === undefined) {
      const opened = await load();
      if (!opened.ok) return opened;
    }
    return ok(copy!);
  }

  async function replace(
    next: Map<string, string>,
  ): Promise<Result<void>> {
    const text = JSON.stringify(Object.fromEntries(next));
    try {
      await fs.writeNew(temp, text, SECRET_FILE_MODE);
      await fs.rename(temp, path);
    } catch {
      await fs.remove(temp).catch(() => {});
      log("secret 파일을 쓰지 못했다");
      return unavailable(UNAVAILABLE_WRITE);
    }
    copy = next;
    return ok(undefined);
  }

  return {
    open: () => serial(load),
    names() {
      if (failure !== undefined || copy === undefined) {
        return unavailable(failure ?? UNAVAILABLE_READ);
      }
      return ok([...copy.keys()].sort());
    },
    get(name) {
      if (failure !== undefined || copy === undefined) {
        return unavailable(failure ?? UNAVAILABLE_READ);
      }
      const value = copy.get(name);
      return value === undefined
        ? err({ code: "not_found", message: "secret이 없다" })
        : ok(value);
    },
    values() {
      if (failure !== undefined || copy === undefined) {
        return unavailable(failure ?? UNAVAILABLE_READ);
      }
      return ok([...copy.values()]);
    },
    put(name, value) {
      if (
        !secretNameSchema.safeParse(name).success ||
        !validValue(value)
      ) {
        return Promise.resolve(err({
          code: "invalid_input" as const,
          message: "secret 이름이나 값이 올바르지 않다",
        }));
      }
      return serial(async () => {
        const current = await ready();
        if (!current.ok) return current;
        const next = new Map(current.value).set(name, value);
        const written = await replace(next);
        if (!written.ok) return written;
        return ok({ name, configured: true });
      });
    },
    delete(name) {
      return serial(async () => {
        const current = await ready();
        if (!current.ok) return current;
        if (!current.value.has(name)) return ok({ name, configured: false });
        const next = new Map(current.value);
        next.delete(name);
        const written = await replace(next);
        if (!written.ok) return written;
        return ok({ name, configured: false });
      });
    },
    stop() {
      stopped = true;
      copy = undefined;
      failure = UNAVAILABLE_STOPPED;
    },
  };
}

// UTF-8 1바이트 이상 64KiB 이하.
function validValue(value: string): boolean {
  if (value.length === 0) return false;
  return new TextEncoder().encode(value).length <= SECRET_INPUT_MAX_BYTES;
}

function parse(text: string): Map<string, string> | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return undefined;
  }
  const entries = new Map<string, string>();
  for (const [name, value] of Object.entries(json)) {
    if (!secretNameSchema.safeParse(name).success) return undefined;
    if (typeof value !== "string" || value.length === 0) return undefined;
    entries.set(name, value);
  }
  return entries;
}
