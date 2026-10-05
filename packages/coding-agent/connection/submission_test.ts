// 제출 파일 검사 테스트다(connection#R10). 실제 temp 폴더와 실제 symlink를 만들어
// submission root 밖·금지 영역으로 이어진 경로가 없는 파일과 같은 답으로 거절되는지
// 본다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../base/mod.ts";
import { err, ok } from "../../base/mod.ts";
import {
  canonicalFilesHash,
  canonicalFilesJson,
  mediaTypeOf,
  resolveSubmission,
  toDocumentFiles,
} from "./submission.ts";

type Layout = {
  base: string;
  root: string;
  data: string;
  otherApp: string;
};

// root/ (연결 source의 작업 폴더) 안에 notes, 다른 앱 source가 있고 root 밖에 운영 data가 있다.
async function layout(): Promise<Layout> {
  const base = await Deno.makeTempDir({ prefix: "lophn-submission-" });
  const root = `${base}/root`;
  const data = `${base}/lophn-data`;
  const otherApp = `${root}/apps/other`;
  await Deno.mkdir(`${root}/notes`, { recursive: true });
  await Deno.mkdir(`${root}/apps/mine`, { recursive: true });
  await Deno.mkdir(otherApp, { recursive: true });
  await Deno.mkdir(data, { recursive: true });
  await Deno.writeTextFile(`${root}/notes/plan.md`, "# plan\n");
  await Deno.writeTextFile(`${root}/notes/extra.txt`, "extra");
  await Deno.writeTextFile(`${data}/ledger.sqlite`, "secret ledger");
  await Deno.writeTextFile(`${otherApp}/main.ts`, "other app source");
  return { base, root: await Deno.realPath(root), data, otherApp };
}

Deno.test("coding-agent/connection#R10: 첫 파일이 primary이고 상대 경로·hash·형식을 낸다", async () => {
  const where = await layout();
  try {
    const resolved = await resolveSubmission(
      [`${where.root}/notes/plan.md`, `${where.root}/notes/extra.txt`],
      { root: where.root, forbidden: [where.data, where.otherApp] },
    );
    assert(resolved.ok, resolved.ok ? "" : resolved.error.message);
    const [first, second] = resolved.value;
    assertEquals(first.primary, true);
    assertEquals(second.primary, false);
    assertEquals(first.path, "plan.md");
    assertEquals(second.path, "extra.txt");
    assertEquals(first.media_type, "text/markdown");
    assertEquals(second.media_type, "text/plain");
    assertEquals(first.bytes, 7);
    assertEquals(first.blob_hash, await sha256Hex("# plan\n"));
    // 열면 같은 bytes가 흐른다.
    const text = await new Response(first.open()).text();
    assertEquals(text, "# plan\n");
  } finally {
    await Deno.remove(where.base, { recursive: true });
  }
});

Deno.test("coding-agent/connection#R10: source처럼 보이는 data symlink와 다른 앱 source는 없는 파일과 같은 답으로 거절한다", async () => {
  const where = await layout();
  try {
    // root 안에 있지만 운영 data로 이어진 symlink.
    await Deno.symlink(
      `${where.data}/ledger.sqlite`,
      `${where.root}/notes/looks-like-source.md`,
    );
    // root 안에 있지만 다른 앱 source로 이어진 symlink.
    await Deno.symlink(
      `${where.otherApp}/main.ts`,
      `${where.root}/apps/mine/main.ts`,
    );
    // 금지 영역이 root 안에 직접 있는 파일.
    const scope = { root: where.root, forbidden: [where.data, where.otherApp] };
    const missing = await resolveSubmission(
      [`${where.root}/notes/nothing.md`],
      scope,
    );
    assert(!missing.ok);
    for (
      const path of [
        `${where.root}/notes/looks-like-source.md`,
        `${where.root}/apps/mine/main.ts`,
        `${where.otherApp}/main.ts`,
        `${where.data}/ledger.sqlite`,
      ]
    ) {
      const denied = await resolveSubmission([path], scope);
      assert(!denied.ok, path);
      // 없는 파일과 같은 code·message다. 존재도 해석한 경로도 새지 않는다.
      assertEquals(denied.error.code, missing.error.code);
      assertEquals(denied.error.message, missing.error.message);
      assertEquals(denied.error.details, { path });
      // 호출자가 준 경로만 되돌아간다. symlink가 가리킨 실제 경로는 새지 않는다.
      if (
        path.endsWith("looks-like-source.md") || path.endsWith("mine/main.ts")
      ) {
        const text = JSON.stringify(denied.error);
        assert(!text.includes(where.data), "운영 data 경로가 새지 않는다");
        assert(!text.includes("apps/other"), "다른 앱 경로가 새지 않는다");
      }
    }
  } finally {
    await Deno.remove(where.base, { recursive: true });
  }
});

Deno.test("coding-agent/connection#R10: root 밖 경로와 root 밖으로 이어진 symlink는 거절하고 root 안 symlink는 realpath로 받는다", async () => {
  const where = await layout();
  try {
    const outside = `${where.base}/outside.md`;
    await Deno.writeTextFile(outside, "outside");
    await Deno.symlink(outside, `${where.root}/notes/escape.md`);
    await Deno.symlink(
      `${where.root}/notes/plan.md`,
      `${where.root}/notes/alias.md`,
    );
    const scope = { root: where.root, forbidden: [where.data] };
    for (const path of [outside, `${where.root}/notes/escape.md`]) {
      const denied = await resolveSubmission([path], scope);
      assert(!denied.ok, path);
      assertEquals(denied.error.code, "invalid_input");
    }
    const alias = await resolveSubmission(
      [`${where.root}/notes/alias.md`],
      scope,
    );
    assert(alias.ok);
    // realpath로 풀린 이름이다. alias 이름이 아니다.
    assertEquals(alias.value[0].path, "plan.md");
  } finally {
    await Deno.remove(where.base, { recursive: true });
  }
});

Deno.test("coding-agent/connection#R10: 폴더·상대 경로·빈 목록·겹친 이름은 거절한다", async () => {
  const where = await layout();
  try {
    const scope = { root: where.root, forbidden: [] };
    for (const path of [`${where.root}/notes`, "notes/plan.md"]) {
      const denied = await resolveSubmission([path], scope);
      assert(!denied.ok, path);
      assertEquals(denied.error.message, "제출할 수 없는 파일이다");
    }
    const empty = await resolveSubmission([], scope);
    assert(!empty.ok);
    await Deno.mkdir(`${where.root}/notes2`);
    await Deno.writeTextFile(`${where.root}/notes2/plan.md`, "x");
    // 첫 파일의 폴더 밖 파일은 이름만 쓰므로 같은 이름이 겹친다.
    const clash = await resolveSubmission(
      [`${where.root}/notes/plan.md`, `${where.root}/notes2/plan.md`],
      scope,
    );
    assert(!clash.ok);
    assertEquals(clash.error.message, "제출 파일의 이름이 겹친다");
  } finally {
    await Deno.remove(where.base, { recursive: true });
  }
});

Deno.test("coding-agent/mcp-server#R13: 파일 목록 hash는 순서와 무관하다", async () => {
  const files = [
    {
      path: "b.txt",
      blob_hash: "a".repeat(64),
      bytes: 1,
      media_type: "text/plain",
      primary: false,
    },
    {
      path: "a.md",
      blob_hash: "b".repeat(64),
      bytes: 2,
      media_type: "text/markdown",
      primary: true,
    },
  ];
  assertEquals(
    await canonicalFilesHash(files),
    await canonicalFilesHash([...files].reverse()),
  );
  assert(canonicalFilesJson(files).startsWith('[{"blob_hash":"b'));
  assertEquals(mediaTypeOf("/x/y.PDF"), "application/pdf");
  assertEquals(mediaTypeOf("/x/y.unknown"), "application/octet-stream");
});

Deno.test("coding-agent/connection#R10: 준비된 blob이 읽은 bytes와 다르면 저장하지 않는다", async () => {
  const where = await layout();
  try {
    const resolved = await resolveSubmission(
      [`${where.root}/notes/plan.md`],
      { root: where.root, forbidden: [] },
    );
    assert(resolved.ok);
    const file = resolved.value[0];
    const blob = {
      preparation: "prep-1",
      principal: "cac",
      purpose: "document_file",
      hash: file.blob_hash,
      size_bytes: file.bytes,
    };
    const good = await toDocumentFiles([file], () => Promise.resolve(ok(blob)));
    assert(good.ok);
    assertEquals(good.value[0].content, { kind: "prepared", blob });
    const changed = await toDocumentFiles(
      [file],
      () => Promise.resolve(ok({ ...blob, hash: "f".repeat(64) })),
    );
    assert(!changed.ok);
    assertEquals(changed.error.code, "conflict");
    // 준비 실패는 그대로 전한다.
    const failed = await toDocumentFiles(
      [file],
      () => Promise.resolve(err({ code: "unavailable", message: "no blob" })),
    );
    assert(!failed.ok);
    assertEquals(failed.error.message, "no blob");
  } finally {
    await Deno.remove(where.base, { recursive: true });
  }
});
