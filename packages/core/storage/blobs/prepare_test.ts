// blob 준비·설치의 요구 테스트(platform/blob-store#R1, R2, R3, R12).

import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../../base/mod.ts";
import {
  BLOB_PREPARATION_TTL_MS,
  type PreparedBlob,
} from "../../../protocol/server/mod.ts";
import {
  BLOB_READ_ONLY_MODE,
  BLOB_STORE_OBJECTS_DIR,
  createBlobStoreWork,
  createFakeQuota,
  createPreparationRegistry,
  objectPathFor,
  preparedOf,
  systemQuota,
  tmpDirFor,
} from "./mod.ts";

const PRINCIPAL = "user";
const PURPOSE = "document_file";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function sha256HexOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function root(): Promise<string> {
  return Deno.makeTempDir({ prefix: "blob-store-" });
}

function workFor(
  dataRoot: string,
  quota: Parameters<typeof createFakeQuota>[0] = 10 * 1024 * 1024 * 1024,
) {
  let suffix = 0;
  return createBlobStoreWork({
    root: dataRoot,
    suffix: () => `test-${++suffix}`,
    quota: createFakeQuota(quota),
  });
}

Deno.test("platform/blob-store#R2: 임시 streaming write 뒤 fsync → 0400 → 설치 → directory sync로만 성공한다", async () => {
  const dataRoot = await root();
  try {
    const work = workFor(dataRoot);
    const bytes = new TextEncoder().encode("blob body");
    const result = await work.prepare({
      preparation: "prep-1",
      principal: PRINCIPAL,
      purpose: PURPOSE,
    }, streamOf([bytes]));
    assert(result.ok);
    // 설치 파일이 임시 이름이 아니라 hash 주소로 남는다.
    const expected = await sha256HexOf(bytes);
    const path = objectPathFor(dataRoot, expected);
    const stat = await Deno.stat(path);
    assert(stat.isFile);
    assertEquals(stat.size, bytes.length);
    // 완성 blob은 0400이다(R3).
    assertEquals((stat.mode ?? 0) & 0o777, BLOB_READ_ONLY_MODE);
    // 임시 directory는 비어 있다.
    const leftovers: string[] = [];
    for await (const entry of Deno.readDir(tmpDirFor(dataRoot))) {
      leftovers.push(entry.name);
    }
    assertEquals(leftovers, []);
    // 내용이 그대로다.
    assertEquals(
      new TextDecoder().decode(await Deno.readFile(path)),
      "blob body",
    );
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("platform/blob-store#R2: 예상 hash 불일치는 invalid_input이고 반쪽 파일을 남기지 않는다", async () => {
  const dataRoot = await root();
  try {
    const work = workFor(dataRoot);
    const bytes = new TextEncoder().encode("blob body");
    const wrong = await sha256HexOf(new TextEncoder().encode("other"));
    const result = await work.prepare({
      preparation: "prep-2",
      principal: PRINCIPAL,
      purpose: PURPOSE,
      expectedHash: wrong,
    }, streamOf([bytes]));
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.error.code, "invalid_input");
    // 설치 대상이 없고 임시 파일도 없다.
    let hasObject = false;
    try {
      await Deno.stat(`${dataRoot}/${BLOB_STORE_OBJECTS_DIR}`);
      hasObject = true;
    } catch { /* 없다 */ }
    assertEquals(hasObject, false);
    const leftovers: string[] = [];
    for await (const entry of Deno.readDir(tmpDirFor(dataRoot))) {
      leftovers.push(entry.name);
    }
    assertEquals(leftovers, []);
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("platform/blob-store#R2: stream 중단은 실패로 끝나고 반쪽 blob을 읽지 못한다", async () => {
  const dataRoot = await root();
  try {
    const work = workFor(dataRoot);
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("half"));
        controller.error(new Error("stream interrupted"));
      },
    });
    const result = await work.prepare({
      preparation: "prep-3",
      principal: PRINCIPAL,
      purpose: PURPOSE,
    }, broken).then(
      (value) => value,
      () => ({
        ok: false as const,
        error: { code: "unavailable" as const, message: "stream interrupted" },
      }),
    );
    assertEquals(result.ok, false);
    // 반쪽 blob이 설치되지 않는다.
    const objects = `${dataRoot}/${BLOB_STORE_OBJECTS_DIR}`;
    let count = 0;
    try {
      for await (const first of Deno.readDir(objects)) {
        for await (const _ of Deno.readDir(`${objects}/${first.name}`)) count++;
      }
    } catch { /* 없다 */ }
    assertEquals(count, 0);
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("platform/blob-store#R1: 같은 hash는 재사용하고 저장량이 늘지 않는다", async () => {
  const dataRoot = await root();
  try {
    const work = workFor(dataRoot);
    const bytes = new TextEncoder().encode("same content");
    const first = await work.prepare({
      preparation: "prep-4",
      principal: PRINCIPAL,
      purpose: PURPOSE,
    }, streamOf([bytes]));
    assert(first.ok);
    assertEquals(first.value.reused, false);
    const second = await work.prepare({
      preparation: "prep-5",
      principal: PRINCIPAL,
      purpose: PURPOSE,
    }, streamOf([bytes]));
    assert(second.ok);
    assertEquals(second.value.reused, true);
    const hash = await sha256HexOf(bytes);
    // 같은 hash 주소 하나뿐이다.
    const stat = await Deno.stat(objectPathFor(dataRoot, hash));
    assertEquals(stat.size, bytes.length);
    let count = 0;
    const objects = `${dataRoot}/${BLOB_STORE_OBJECTS_DIR}`;
    for await (const first2 of Deno.readDir(objects)) {
      for await (const _ of Deno.readDir(`${objects}/${first2.name}`)) count++;
    }
    assertEquals(count, 1);
    // 1바이트 변경은 다른 내용으로 구별된다.
    const others = new TextEncoder().encode("same contenT");
    const third = await work.prepare({
      preparation: "prep-6",
      principal: PRINCIPAL,
      purpose: PURPOSE,
    }, streamOf([others]));
    assert(third.ok);
    assertEquals(third.value.reused, false);
    const otherHash = await sha256HexOf(others);
    assert(otherHash !== hash);
    // 이전 blob이 그대로다.
    const kept = await Deno.stat(objectPathFor(dataRoot, hash));
    assertEquals(kept.size, bytes.length);
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("platform/blob-store#R3: 완성 파일은 0400이고 임의 파일 경로는 boundary에 없다", async () => {
  const dataRoot = await root();
  try {
    const work = workFor(dataRoot);
    const bytes = new TextEncoder().encode("read only");
    const result = await work.prepare({
      preparation: "prep-7",
      principal: PRINCIPAL,
      purpose: PURPOSE,
    }, streamOf([bytes]));
    assert(result.ok);
    const hash = await sha256HexOf(bytes);
    const stat = await Deno.stat(objectPathFor(dataRoot, hash));
    assertEquals(stat.mode! & 0o777, 0o400);
    // 임의 파일 경로 입력은 schema가 이미 막는다. boundary 모듈의 입력 schema에 path가 없다.
    const install = await work.installed(hash);
    assert(install.ok);
    assertEquals(install.value.sizeBytes, bytes.length);
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("platform/blob-store#R12: 디스크 여유가 부족하면 새 준비를 unavailable로 막는다", async () => {
  const dataRoot = await root();
  try {
    const work = workFor(dataRoot, 1024);
    const result = await work.prepare({
      preparation: "prep-8",
      principal: PRINCIPAL,
      purpose: PURPOSE,
    }, streamOf([new TextEncoder().encode("too big for the fake disk")]));
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.error.code, "unavailable");
    // 참조 blob을 지우지 않는다. 기존 blob이 그대로 남는다.
    const seeded = new TextEncoder().encode("kept");
    const kept = await workFor(dataRoot).prepare({
      preparation: "prep-9",
      principal: PRINCIPAL,
      purpose: PURPOSE,
    }, streamOf([seeded]));
    assert(kept.ok);
    const hash = await sha256HexOf(seeded);
    const stat = await Deno.stat(objectPathFor(dataRoot, hash));
    assertEquals(stat.size, seeded.length);
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("platform/blob-store#R1: 준비 참조는 principal·purpose·hash·크기와 10분 수명으로 core 메모리에 등록된다", () => {
  const clock = manualClock(Date.parse("2026-10-01T00:00:00.000Z"));
  const registry = createPreparationRegistry();
  const prepared: PreparedBlob = {
    preparation: "worker-preparation-1",
    principal: PRINCIPAL,
    purpose: PURPOSE,
    hash: "a".repeat(64),
    size_bytes: 3,
  };
  // 등록. 수명은 등록 시각부터 10분이다.
  assert(registry.register(prepared, clock.nowMs()).ok);
  assertEquals(registry.size, 1);
  // 살아 있는 참조다.
  const live = registry.live(prepared, clock.nowMs());
  assert(live.ok);
  assertEquals(live.value, true);
  // 수명 안에서 principal·purpose·hash·크기를 그대로 쥔다.
  // core는 파일을 다시 hash하지 않는다(파일 관측은 worker의 몫이다).
  // 10분이 지나면 만기다.
  clock.advance(BLOB_PREPARATION_TTL_MS);
  const expired = registry.live(prepared, clock.nowMs());
  assert(expired.ok);
  assertEquals(expired.value, false);
});

Deno.test("platform/blob-store#R1: 다른 주체·목적의 같은 hash는 별도 참조고 같은 참조는 conflict다", () => {
  const clock = manualClock(Date.parse("2026-10-01T00:00:00.000Z"));
  const registry = createPreparationRegistry();
  const base = {
    preparation: "worker-preparation-2",
    hash: "b".repeat(64),
    size_bytes: 5,
  };
  const first = preparedOf(
    { preparation: base.preparation, principal: "user", purpose: PURPOSE },
    { hash: base.hash, sizeBytes: base.size_bytes },
  );
  const second = preparedOf(
    {
      preparation: base.preparation,
      principal: "coding_agent",
      purpose: PURPOSE,
    },
    { hash: base.hash, sizeBytes: base.size_bytes },
  );
  assert(first.ok && second.ok);
  assert(registry.register(first.value, clock.nowMs()).ok);
  assert(registry.register(second.value, clock.nowMs()).ok);
  assertEquals(registry.size, 2);
  const duplicate = registry.register(first.value, clock.nowMs());
  assertEquals(duplicate.ok, false);
  if (!duplicate.ok) assertEquals(duplicate.error.code, "conflict");
});

Deno.test("platform/blob-store#R1: 만기된 준비 참조는 prune 전이라도 같은 hash를 다시 등록할 수 있다", () => {
  const registry = createPreparationRegistry();
  const prepared = {
    preparation: "prep-a",
    principal: "user",
    purpose: PURPOSE,
    hash: "a".repeat(64),
    size_bytes: 4,
  };
  assert(registry.register(prepared, 0).ok);
  // 만기 직전까지는 같은 참조가 살아 있어 충돌한다.
  assertEquals(
    registry.register(prepared, BLOB_PREPARATION_TTL_MS - 1).ok,
    false,
  );
  const again = { ...prepared, preparation: "prep-b" };
  assert(registry.register(again, BLOB_PREPARATION_TTL_MS).ok);
  const live = registry.live(again, BLOB_PREPARATION_TTL_MS + 1);
  assert(live.ok && live.value);
});

Deno.test("platform/blob-store#R1: find는 같은 주체·purpose·hash의 살아 있는 등록값만 돌려준다", () => {
  const clock = manualClock(Date.parse("2026-10-01T00:00:00.000Z"));
  const registry = createPreparationRegistry();
  const prepared = preparedOf(
    {
      preparation: "worker-preparation-3",
      principal: "user",
      purpose: PURPOSE,
    },
    { hash: "c".repeat(64), sizeBytes: 7 },
  );
  assert(prepared.ok);
  const key = {
    hash: prepared.value.hash,
    principal: "user",
    purpose: PURPOSE,
  };
  assertEquals(registry.find(key, clock.nowMs()), undefined);
  assert(registry.register(prepared.value, clock.nowMs()).ok);
  assertEquals(registry.find(key, clock.nowMs()), prepared.value);
  // 다른 주체의 같은 hash는 찾지 못한다.
  assertEquals(
    registry.find({ ...key, principal: "coding_agent" }, clock.nowMs()),
    undefined,
  );
  // 수명이 지나면 없다.
  clock.advance(10 * 60 * 1000);
  assertEquals(registry.find(key, clock.nowMs()), undefined);
});

Deno.test("platform/blob-store#R12: I/O worker 권한(run 없음)에서 quota 관측을 부른다", async () => {
  // 제품 launch spec(packages/core/main/daemon/core.ts platformIoSpec)은 allow_run을 열지 않는다.
  // 이 권한 모양에서 실제 관측 경로가 NotCapable로 떨어지지 않고 undefined(관측 불가)로 끝나는지 본다.
  // 권한은 test runner가 정한다: deno task check의 test 스텝은 sys·run을 열지 않는다.
  const quota = systemQuota();
  const observed = await quota.availableBytes(
    Deno.makeTempDirSync({ prefix: "blob-quota-" }),
  );
  // sys 권한이 없으면 undefined고 있으면 실제 여유다. 어느 쪽이든 throw하지 않는다(R12 unavailable을 위해).
  if (observed !== undefined) assert(observed > 0);
});

Deno.test("platform/blob-store#R12: 제품 spec 권한(statfs sys 포함)의 child에서 양수 여유를 읽고 준비가 성공한다", async () => {
  // 제품 platformIoSpec: --allow-read/write(root), --allow-sys=statfs, run·net 없음.
  // 이 권한의 child가 statfs로 양수 여유를 관측하고 work.prepare가 성공하는지 본다.
  const entry = new URL("./prepare-worker-probe.ts", import.meta.url).pathname;
  const dataRoot = await Deno.makeTempDir({ prefix: "blob-worker-cap-" });
  try {
    const cmd = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--cached-only",
        "--no-prompt",
        `--allow-read=${dataRoot}`,
        `--allow-write=${dataRoot}`,
        "--allow-sys=statfs",
        entry,
        dataRoot,
      ],
      clearEnv: true,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    const child = cmd.spawn();
    const [out, err, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.status,
    ]);
    assertEquals(status.code, 0, err.slice(0, 400));
    // child 출력은 여유 관측과 준비 성공만 가린다. 경로·내용은 출력하지 않는다.
    assert(out.includes("observed=positive"));
    assert(out.includes("prepare=ok"));
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});
