// thread bookmark는 <dataRoot>/shell/thread-bookmarks.json 하나에 main만 쓴다. 사람이 모은 목록이라 파일이
// 깨져 있으면(JSON 아님, schema 불일치) 어떤 쓰기도 그 파일을 덮어쓰지 않고 옮겨 읽지도 않는다.
// session key는 lophn이 `ses_…`, harness가 `<harness>:<cli_session>`이고 message key는 화면이 정한다.
import { join } from "node:path";
import { z } from "zod";

import {
  defaultStoreDeps,
  type StoreDeps,
  writeFileAtomic,
} from "../workspace/atomic-file.ts";

export type ThreadBookmarkReason = "corrupt" | "unreadable" | "unwritable";

type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ThreadBookmarkReason };

type FileShape = z.infer<typeof fileSchema>;

const fileSchema = z.record(
  z.string(),
  z.array(z.strictObject({ message: z.string(), at: z.string() })),
);

export function createThreadBookmarkStore(
  dataRoot: string,
  deps: { clock: { nowIso(): string }; fs?: Partial<StoreDeps> },
) {
  const impl: StoreDeps = { ...defaultStoreDeps, ...deps.fs };
  const file = join(dataRoot, "shell", "thread-bookmarks.json");

  async function read(): Promise<Outcome<FileShape>> {
    let raw: Uint8Array;
    try {
      raw = await impl.readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: true, value: {} };
      }
      return { ok: false, reason: "unreadable" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return { ok: false, reason: "corrupt" };
    }
    const result = fileSchema.safeParse(parsed);
    return result.success
      ? { ok: true, value: result.data }
      : { ok: false, reason: "corrupt" };
  }

  // 읽고-바꾸고-쓰는 한 번이 다른 쓰기와 섞이지 않게 줄 세운다(창 둘이 같이 누를 수 있다). 앞 쓰기가 실패해도 뒤는 돈다.
  let tail: Promise<unknown> = Promise.resolve();

  return {
    async list(session: string): Promise<Outcome<string[]>> {
      const current = await read();
      if (!current.ok) return current;
      return {
        ok: true,
        value: (current.value[session] ?? []).map((one) => one.message),
      };
    },
    set(session: string, message: string, on: boolean): Promise<Outcome<null>> {
      const run = async (): Promise<Outcome<null>> => {
        const current = await read();
        if (!current.ok) return current;
        const marks = current.value[session] ?? [];
        const has = marks.some((one) => one.message === message);
        if (on === has) return { ok: true, value: null };
        const next = on
          ? [...marks, { message, at: deps.clock.nowIso() }]
          : marks.filter((one) => one.message !== message);
        const others = Object.fromEntries(
          Object.entries(current.value).filter(([key]) => key !== session),
        );
        const written = await writeFileAtomic(
          file,
          JSON.stringify(
            next.length === 0 ? others : { ...others, [session]: next },
          ),
          impl,
        );
        return written.ok
          ? { ok: true, value: null }
          : { ok: false, reason: "unwritable" };
      };
      const promise = tail.then(run);
      tail = promise.catch(() => {});
      return promise;
    },
  };
}
