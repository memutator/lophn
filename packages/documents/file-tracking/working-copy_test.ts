import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import { denoFileOps } from "./adapters/file-ops.ts";
import { createFileSerializer } from "./file-ops.ts";
import { type FileDeps } from "./files.ts";
import {
  confirmCopy,
  fromBase64,
  readLocation,
  writeLocation,
} from "./prepared-files.ts";
import {
  encodeWorkingCopyMeta,
  parseWorkingCopyMeta,
  workingCopyLocation,
  type WorkingCopyMeta,
  workingCopyState,
} from "./working-copy.ts";

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const VERSION = "ver_01arz3ndektsv4rrffq69g5fav";
const NEXT_VERSION = "ver_01arz3ndektsv4rrffq69g5faw";

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function depsOver(): FileDeps {
  let counter = 0;
  return {
    ops: denoFileOps(),
    serializer: createFileSerializer(),
    clock: { nowIso: () => "2026-10-06T00:00:00.000Z" },
    token: () => `w${++counter}`,
  };
}

async function* chunks(text: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(text);
}

function meta(confirmed: string): WorkingCopyMeta {
  return {
    document: DOC,
    base_version: VERSION,
    primary_path: "note.md",
    media_type: "text/markdown",
    confirmed_hash: confirmed,
  };
}

async function withData(
  run: (dataRoot: string) => Promise<void>,
): Promise<void> {
  const dataRoot = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-wc-" }),
  );
  try {
    await run(dataRoot);
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
}

async function prepare(dataRoot: string) {
  const located = workingCopyLocation(dataRoot, DOC);
  assert(located.ok);
  await Deno.mkdir(located.value.root, { recursive: true });
  return located.value;
}

Deno.test("documents/file-tracking#R1: working copy 위치는 doc ID 폴더 하나고 doc ID가 아닌 값은 경로가 되지 않는다", () => {
  const located = workingCopyLocation("/data", DOC);
  assert(located.ok);
  assertEquals(
    located.value.root,
    `/data/documents/working-copies/${DOC}`,
  );
  assertEquals(located.value.content, `${located.value.root}/content`);
  for (
    const bad of ["../escape", "", `${DOC}/..`, "doc_short", "prj_" + "a".repeat(26)]
  ) {
    const rejected = workingCopyLocation("/data", bad);
    assert(!rejected.ok, bad);
    assertEquals(rejected.error.code, "invalid_input");
  }
  assert(!workingCopyLocation("relative", DOC).ok);
});

Deno.test("documents/file-tracking#R1: metadata는 모양이 맞을 때만 읽고, 확정한 내용과 같으면 tracked다", () => {
  const stored = meta(sha("base"));
  const roundTrip = parseWorkingCopyMeta(
    JSON.parse(new TextDecoder().decode(encodeWorkingCopyMeta(stored))),
  );
  assertEquals(roundTrip, stored);
  assertEquals(parseWorkingCopyMeta({ ...stored, extra: 1 }), undefined);
  assertEquals(parseWorkingCopyMeta({ document: DOC }), undefined);
  assertEquals(workingCopyState(stored, sha("base")), "tracked");
  assertEquals(workingCopyState(stored, sha("edited")), "version_pending");
});

Deno.test("documents/file-tracking#R1: 선택한 판으로 만든 사본을 편집하면 내용이 사본에 남고 새 문서나 project는 생기지 않는다", async () => {
  await withData(async (dataRoot) => {
    const place = await prepare(dataRoot);
    const deps = depsOver();
    const location = { root: place.root, path: place.content, meta: place.meta };
    // 아직 없는 사본은 없는 것으로 읽힌다.
    const absent = await readLocation(deps, location);
    assert(absent.ok);
    assertEquals(absent.value.exists, false);

    const created = await writeLocation(deps, {
      location,
      base_hash: null,
      content: { channel: 1, bytes: 4, hash: sha("base") },
      meta_create: new TextDecoder().decode(
        encodeWorkingCopyMeta(meta(sha("base"))),
      ),
    }, chunks("base"));
    assert(created.ok);
    assertEquals(created.value.outcome, "written");

    const edited = await writeLocation(deps, {
      location,
      base_hash: sha("base"),
      content: { channel: 1, bytes: 6, hash: sha("edited") },
    }, chunks("edited"));
    assert(edited.ok);

    const read = await readLocation(deps, location);
    assert(read.ok);
    assertEquals(read.value.exists, true);
    assertEquals(read.value.hash, sha("edited"));
    assertEquals(
      new TextDecoder().decode(fromBase64(read.value.bytes_b64!)),
      "edited",
    );
    // metadata는 첫 쓰기에서 한 번만 만들고 편집이 덮지 않는다.
    assertEquals(parseWorkingCopyMeta(read.value.meta), meta(sha("base")));
    // 사본 폴더 밖에는 아무것도 만들어지지 않았다.
    const names: string[] = [];
    for await (const entry of Deno.readDir(dataRoot)) names.push(entry.name);
    assertEquals(names, ["documents"]);
  });
});

Deno.test("documents/file-tracking#R11: 사본도 base_hash가 다르면 conflict고 외부에서 고친 사본 내용이 남는다", async () => {
  await withData(async (dataRoot) => {
    const place = await prepare(dataRoot);
    const deps = depsOver();
    const location = { root: place.root, path: place.content, meta: place.meta };
    await Deno.writeTextFile(place.content, "someone else");
    const stale = await writeLocation(deps, {
      location,
      base_hash: sha("what I opened"),
      content: { channel: 1, bytes: 4, hash: sha("mine") },
    }, chunks("mine"));
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
    assertEquals(await Deno.readTextFile(place.content), "someone else");
  });
});

Deno.test("documents/file-tracking#R1: 새 판이 확정되면 사본 metadata의 연 판과 확정 내용이 바뀐다", async () => {
  await withData(async (dataRoot) => {
    const place = await prepare(dataRoot);
    const deps = depsOver();
    const location = { root: place.root, path: place.content, meta: place.meta };
    const created = await writeLocation(deps, {
      location,
      base_hash: null,
      content: { channel: 1, bytes: 6, hash: sha("edited") },
      meta_create: new TextDecoder().decode(
        encodeWorkingCopyMeta(meta(sha("base"))),
      ),
    }, chunks("edited"));
    assert(created.ok);
    const before = await readLocation(deps, location);
    assert(before.ok);
    const stored = parseWorkingCopyMeta(before.value.meta)!;
    assertEquals(workingCopyState(stored, before.value.hash!), "version_pending");

    const confirmed = await confirmCopy(deps, {
      root: place.root,
      meta: place.meta,
      baseVersion: NEXT_VERSION,
      confirmedHash: sha("edited"),
    });
    assert(confirmed.ok);
    const after = await readLocation(deps, location);
    assert(after.ok);
    const updated = parseWorkingCopyMeta(after.value.meta)!;
    assertEquals(updated.base_version, NEXT_VERSION);
    assertEquals(workingCopyState(updated, after.value.hash!), "tracked");
    // 사본 내용은 그대로다.
    assertEquals(await Deno.readTextFile(place.content), "edited");
  });
});

Deno.test("documents/file-tracking#R1: 사본이 아닌 곳의 metadata는 읽지도 확정하지도 않는다", async () => {
  await withData(async (dataRoot) => {
    const place = await prepare(dataRoot);
    const deps = depsOver();
    const missing = await confirmCopy(deps, {
      root: place.root,
      meta: place.meta,
      baseVersion: NEXT_VERSION,
      confirmedHash: sha("x"),
    });
    assert(!missing.ok);
    assertEquals(missing.error.code, "invalid_input");
    await Deno.writeTextFile(place.meta, "{not json");
    const broken = await confirmCopy(deps, {
      root: place.root,
      meta: place.meta,
      baseVersion: NEXT_VERSION,
      confirmedHash: sha("x"),
    });
    assert(!broken.ok);
    // 깨진 metadata를 덮어써서 되살리지 않는다.
    assertEquals(await Deno.readTextFile(place.meta), "{not json");
  });
});
