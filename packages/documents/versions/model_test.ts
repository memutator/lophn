import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../base/mod.ts";
import { canonicalFilesJson, contentUnchanged, filesHash } from "./model.ts";
import { file } from "./testing-fixture.ts";

const HASH = "ab".repeat(32);
const format = { name: "document", module_hash: HASH, explicit: false };

Deno.test("documents/versions#R1: 정규화 목록은 경로 codepoint 순의 고정 필드 JSON이다", async () => {
  const files = [
    file("b.md", false),
    file("a.md", true),
    file("a/c.md", false),
  ];
  const json = canonicalFilesJson(files);
  const ordered = JSON.parse(json) as { path: string }[];
  assertEquals(ordered.map((item) => item.path), ["a.md", "a/c.md", "b.md"]);
  // 키는 codepoint 순이고 공백이 없다.
  assert(json.startsWith('[{"blob_hash":'));
  assert(!json.includes(" "));
  // 같은 입력을 두 번 돌리면 같은 hash다.
  assertEquals(await filesHash(files), await sha256Hex(json));
  assertEquals(await filesHash(files), await filesHash([...files].reverse()));
});

Deno.test("documents/versions#R3: 같은 내용과 format 계약만 unchanged다", () => {
  const latest = { content_hash: HASH, format };
  assert(contentUnchanged(latest, { content_hash: HASH, format }));
  assert(!contentUnchanged(latest, { content_hash: "cd".repeat(32), format }));
  assert(
    !contentUnchanged(latest, {
      content_hash: HASH,
      format: { ...format, explicit: true },
    }),
  );
  assert(
    !contentUnchanged(latest, {
      content_hash: HASH,
      format: { ...format, name: "pdf" },
    }),
  );
  assert(
    !contentUnchanged(latest, {
      content_hash: HASH,
      format: { ...format, module_hash: "cd".repeat(32) },
    }),
  );
});
