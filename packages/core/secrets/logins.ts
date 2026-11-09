// `<data root>/logins.json`(0600): login metadata 목록. 값은 없다(값은 secrets.json의 `login.<id>.*`).
// 파일이 없으면 빈 목록이다. 쓰기는 임시 파일에 0600으로 쓰고 rename한다.
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../base/mod.ts";
import {
  type Login,
  LOGINS_FILE_NAME,
  loginsFileSchema,
} from "../../protocol/secrets/mod.ts";

type Change<T> = (logins: Login[]) => Result<{ logins: Login[]; value: T }>;

export type LoginStore = {
  list(): Promise<Result<Login[]>>;
  // 목록 전체를 바꾼다. 읽고 바꾸는 사이에 다른 쓰기가 끼지 않게 한 번에 하나씩 돈다.
  update<T>(change: Change<T>): Promise<Result<T>>;
};

const unavailable = (message: string) =>
  err({ code: "unavailable" as const, message });

export function createLoginStore(options: { root: string }): LoginStore {
  const path = `${options.root}/${LOGINS_FILE_NAME}`;
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<Result<Login[]>> {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return ok([]);
      return unavailable("logins 파일을 읽을 수 없다");
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return unavailable("logins 파일 모양이 맞지 않는다");
    }
    const parsed = loginsFileSchema.safeParse(json);
    return parsed.success
      ? ok(parsed.data)
      : unavailable("logins 파일 모양이 맞지 않는다");
  }

  return {
    list: read,
    update<T>(change: Change<T>) {
      const run = async (): Promise<Result<T>> => {
        const current = await read();
        if (!current.ok) return current;
        const changed = change(current.value);
        if (!changed.ok) return changed;
        const temp = `${path}.tmp`;
        try {
          await writeFile(temp, JSON.stringify(changed.value.logins), {
            mode: 0o600,
          });
          await chmod(temp, 0o600);
          await rename(temp, path);
        } catch {
          await rm(temp).catch(() => {});
          return unavailable("logins 파일을 쓰지 못했다");
        }
        return ok(changed.value.value);
      };
      const next = queue.then(run, run);
      queue = next.catch(() => {});
      return next;
    },
  };
}
