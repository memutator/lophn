import { assert, assertEquals } from "@std/assert";
import { ok } from "../../base/mod.ts";
import { secretStatusHandler } from "./routes.ts";
import { createSecretFileStore, type SecretFs } from "./file-store.ts";
import { openSecretStore } from "./secret-store.ts";

const ROOT = "/data";
const PATH = `${ROOT}/secrets.json`;
const MARKER = "MARKER-sk-live-9f3a";

type Fails = Partial<Record<"readText" | "writeNew" | "rename", boolean>>;

function fakeFs(initial?: { text: string; mode: number }) {
  const files = new Map<string, { text: string; mode: number }>();
  if (initial !== undefined) files.set(PATH, initial);
  const fails: Fails = {};
  const missing = () => new Deno.errors.NotFound("no file");
  const fs: SecretFs = {
    readText(path) {
      // 예외 message에 표지 문자열과 경로를 넣어, 오류가 그 message를 옮기지 않는지 본다.
      if (fails.readText) {
        return Promise.reject(new Error(`read ${path} ${MARKER}`));
      }
      const file = files.get(path);
      return file ? Promise.resolve(file.text) : Promise.reject(missing());
    },
    mode(path) {
      const file = files.get(path);
      return file ? Promise.resolve(file.mode) : Promise.reject(missing());
    },
    chmod(path, mode) {
      const file = files.get(path);
      if (!file) return Promise.reject(missing());
      file.mode = mode;
      return Promise.resolve();
    },
    writeNew(path, text, mode) {
      if (fails.writeNew) {
        files.set(path, { text: text.slice(0, 3), mode });
        return Promise.reject(new Error(`write ${path} ${text}`));
      }
      files.set(path, { text, mode });
      return Promise.resolve();
    },
    rename(from, to) {
      if (fails.rename) return Promise.reject(new Error(`rename ${MARKER}`));
      const file = files.get(from);
      if (!file) return Promise.reject(missing());
      files.delete(from);
      files.set(to, file);
      return Promise.resolve();
    },
    remove(path) {
      files.delete(path);
      return Promise.resolve();
    },
  };
  return { fs, files, fails };
}

function open(fake: ReturnType<typeof fakeFs>) {
  const log: string[] = [];
  const file = createSecretFileStore({
    root: ROOT,
    fs: fake.fs,
    log: (line) => log.push(line),
  });
  return { file, log };
}

Deno.test("secret 파일은 0600이고, 쓰기가 실패하면 이전 값이 남고 임시 파일이 없다", async () => {
  const fake = fakeFs({ text: '{"a":"old"}', mode: 0o644 });
  const { file } = open(fake);
  assert((await file.open()).ok);
  assertEquals(fake.files.get(PATH)!.mode, 0o600);

  assert((await file.put("a", "new")).ok);
  assertEquals(fake.files.get(PATH)!.mode, 0o600);
  assertEquals(file.get("a"), ok("new"));
  assert((await file.put("b", "two")).ok);
  assertEquals(fake.files.get(PATH)!.mode, 0o600);
  assertEquals(await file.delete("b"), ok({ name: "b", configured: false }));
  assertEquals(
    await file.delete("nope"),
    ok({ name: "nope", configured: false }),
  );
  assertEquals(fake.files.get(PATH)!.mode, 0o600);

  for (const step of ["writeNew", "rename"] as const) {
    fake.fails[step] = true;
    const before = fake.files.get(PATH)!.text;
    const failed = await file.put("a", "other");
    assert(!failed.ok);
    delete fake.fails[step];
    assertEquals(fake.files.get(PATH)!.text, before);
    assertEquals([...fake.files.keys()], [PATH]);
    assertEquals(file.get("a"), ok("new"));
  }
});

Deno.test("값은 반환 오류·log·status 응답·알려진 값 표면에 나가지 않는다", async () => {
  type Run = (fake: ReturnType<typeof fakeFs>) => Promise<unknown[]>;
  const cases: Record<
    string,
    { fake: () => ReturnType<typeof fakeFs>; run: Run }
  > = {
    성공: {
      fake: () => fakeFs(),
      run: async (fake) => {
        const { file } = open(fake);
        await file.open();
        return [await file.put("a", MARKER)];
      },
    },
    상한초과: {
      fake: () => fakeFs(),
      run: async (fake) => {
        const { file } = open(fake);
        await file.open();
        return [await file.put("a", MARKER + "x".repeat(64 * 1024))];
      },
    },
    쓰기실패: {
      fake: () => fakeFs(),
      run: async (fake) => {
        const { file } = open(fake);
        await file.open();
        fake.fails.writeNew = true;
        return [await file.put("a", MARKER)];
      },
    },
    읽기실패: {
      fake: () => {
        const fake = fakeFs({ text: "{}", mode: 0o600 });
        fake.fails.readText = true;
        return fake;
      },
      run: async (fake) => {
        const { file } = open(fake);
        return [await file.open(), file.get("a"), await file.put("a", MARKER)];
      },
    },
    깨진파일: {
      fake: () => fakeFs({ text: `{"a": "${MARKER}`, mode: 0o600 }),
      run: async (fake) => {
        const { file } = open(fake);
        return [await file.open(), file.names()];
      },
    },
  };
  for (const [name, { fake: make, run }] of Object.entries(cases)) {
    const fake = make();
    const surface: unknown[] = await run(fake);
    // log와 status 응답, 알려진 값 표면도 같은 조건으로 모은다.
    const { file, log } = open(fake);
    await file.open();
    const store = openSecretStore({
      file,
      channel: {
        register: () => Promise.resolve(ok(undefined)),
        revoke: () => Promise.resolve(ok(undefined)),
        setReady: () => Promise.resolve(ok(undefined)),
      },
      retryMs: 60_000,
    });
    await store.sync();
    const status = await secretStatusHandler(store)(
      { actor: "user" } as never,
      {},
    );
    surface.push(log, status, store.known, Object.keys(store.known));
    store.stop();
    assert(!JSON.stringify(surface).includes(MARKER), `${name}: 값이 샜다`);
  }
});
