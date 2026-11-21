import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { manualClock } from "../../../base/mod.ts";
import { APP_FILE_SAMPLE_TEXT } from "../../../protocol/apps/app-file-values.ts";
import { appDataFolder } from "../../../protocol/apps/app-storage.ts";
import { appFileRoutes } from "./routes.ts";
import { createAppFileStore, seedAppFiles } from "./store.ts";

const A = `app_01${"a".repeat(24)}`;
const B = `app_01${"b".repeat(24)}`;
const NONCE = "preview-nonce-1";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "lophn-app-files-"));
  const clock = manualClock(Date.now());
  for (const app of [A, B]) {
    await mkdir(appDataFolder(root, app), { recursive: true });
  }
  const previewDir = join(root, "apps", A, "preview", NONCE);
  await mkdir(previewDir, { recursive: true });
  await seedAppFiles(previewDir);
  const routes = new Map(
    appFileRoutes({
      dataRoot: root,
      store: createAppFileStore({ clock }),
      appStatus: () => "active",
      previewRunning: (_app, nonce) => nonce === NONCE,
    }),
  );
  const call = (name: string, input: unknown) =>
    routes.get(name)!({} as never, input as never) as Promise<{
      ok: boolean;
      value?: Record<string, unknown>;
      error?: { code: string; details?: Record<string, unknown> };
    }>;
  return { root, clock, call };
}

const put = (
  call: Awaited<ReturnType<typeof setup>>["call"],
  app: string,
  whole: Buffer,
  piece: Buffer,
  offset: number,
  file = sha(whole),
) =>
  call("app_files/put", {
    app,
    file,
    size: whole.length,
    type: "text/plain",
    offset,
    bytes_base64: piece.toString("base64"),
  });

// 사진과 file은 사용자 data다. 틀린 bytes가 읽히는 file로 남거나, 이미 있는 file이 다시 쓰이면 안 된다.
test("app file put는 맞지 않는 file을 읽히지 않게 버리고, 틀린 offset은 쥔 bytes를 알리고, 있는 file은 다시 쓰지 않는다", async () => {
  const { root, call } = await setup();
  try {
    const whole = Buffer.from("hello app file");
    const live = { mode: "live", app: A, release: null };
    const read = (file: string) =>
      call("app_files/read", { target: live, file, offset: 0, length: 64 });

    // 크기는 맞고 내용이 다르다.
    const forged = await put(call, A, whole, Buffer.from("HELLO app file"), 0);
    assert.equal(forged.error?.code, "invalid_input");
    assert.equal((await read(sha(whole))).error?.code, "not_found");
    // 조각이 이어지는 자리가 아니면 쥔 bytes를 알린다.
    const first = await put(call, A, whole, whole.subarray(0, 5), 0);
    assert.deepEqual(first.value, { status: "partial", received: 5 });
    const skipped = await put(call, A, whole, whole.subarray(8), 8);
    assert.equal(skipped.error?.code, "invalid_input");
    assert.equal(skipped.error?.details?.received, 5);
    const rest = await put(call, A, whole, whole.subarray(5), 5);
    assert.deepEqual(rest.value, { status: "stored", received: whole.length });
    assert.equal(
      (await read(sha(whole))).value?.bytes_base64,
      whole.toString("base64"),
    );

    // 이미 있는 file은 `have`이고 다시 쓰지 않는다.
    const blob = join(
      appDataFolder(root, A),
      "files",
      sha(whole).slice(0, 2),
      sha(whole),
    );
    const before = (await stat(blob)).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const again = await put(call, A, whole, whole, 0);
    assert.deepEqual(again.value, { status: "have", received: whole.length });
    assert.equal((await stat(blob)).mtimeMs, before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// store는 route의 schema 뒤에서만 안전하면 안 된다: hash가 아닌 이름으로 앱 폴더 밖을 읽거나 쓰지 못한다.
test("app file store는 hash가 아닌 이름을 스스로 거절한다", async () => {
  const { root } = await setup();
  try {
    const store = createAppFileStore({ clock: manualClock(Date.now()) });
    const area = appDataFolder(root, A);
    const read = await store.read(area, "../../../app.sqlite", 0, 10);
    assert.ok(!read.ok && read.error.code === "invalid_input");
    const put = await store.put(area, {
      file: "../escape",
      size: 1,
      type: "x/y",
      offset: 0,
      bytes: new Uint8Array([1]),
    });
    assert.ok(!put.ok && put.error.code === "invalid_input");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("app file read는 다른 앱의 file을 주지 않고 preview는 preview의 영역(sample 포함)을 읽는다", async () => {
  const { root, call } = await setup();
  try {
    const whole = Buffer.from("only in app A");
    await put(call, A, whole, whole, 0);
    const ask = (app: string, file: string, target?: unknown) =>
      call("app_files/read", {
        target: target ?? { mode: "live", app, release: null },
        file,
        offset: 0,
        length: 64,
      });
    assert.equal((await ask(A, sha(whole))).ok, true);
    assert.equal((await ask(B, sha(whole))).error?.code, "not_found");

    const preview = { mode: "preview", app: A, process_nonce: NONCE };
    // preview는 live의 file이 아니라 자기 영역의 file을 읽는다.
    assert.equal((await ask(A, sha(whole), preview)).error?.code, "not_found");
    const sample = await ask(A, APP_FILE_SAMPLE_TEXT.handle.file, preview);
    assert.equal(sample.value?.type, "text/plain");
    assert.equal(sample.value?.bytes_base64, APP_FILE_SAMPLE_TEXT.bytes_base64);
    // live의 영역에는 sample이 없다.
    assert.equal(
      (await ask(A, APP_FILE_SAMPLE_TEXT.handle.file)).error?.code,
      "not_found",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
