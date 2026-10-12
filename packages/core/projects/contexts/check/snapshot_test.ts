import { assertEquals, assertNotEquals } from "@std/assert";
import { createHash } from "node:crypto";
import { inlineFiles } from "../extract/testing.ts";
import type { ProjectFiles } from "../extract/types.ts";
import { snapshotHash } from "./snapshot.ts";

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

// snapshot.ts의 바이트 배열을 시험 안에서 따로 만든다:
//   파일마다 <path UTF-8> 0x00 <내용 sha256 hex> 0x0A, path의 code unit 순
function layout(files: [string, string | null][]): string {
  const lines = [...files]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, content]) =>
      `${path}\u0000${content === null ? "" : sha256(content)}\n`
    );
  return sha256(new TextEncoder().encode(lines.join("")));
}

const filesOf = (entries: [string, string | null][]): ProjectFiles => ({
  paths: () => entries.map(([path]) => path),
  read: (path) => entries.find(([p]) => p === path)?.[1] ?? null,
});

Deno.test("documents/contexts#R20 [ctx-I23]: the hash is sha256 over sorted 'path NUL content-sha256 LF' lines", () => {
  const entries: [string, string | null][] = [
    ["b/two.md", "# Two\n"],
    ["a.md", "# One\n"],
    ["한글/세번째.md", "세 번째"],
  ];
  assertEquals(snapshotHash(filesOf(entries)), layout(entries));
  assertEquals(
    snapshotHash(inlineFiles({ "a.md": "x" })),
    layout([["a.md", "x"]]),
  );
});

Deno.test("documents/contexts#R20 [ctx-I23]: a snapshot with no files hashes the empty byte array", () => {
  assertEquals(
    snapshotHash(filesOf([])),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

Deno.test("documents/contexts#R20 [ctx-I23]: the order paths() lists files in does not matter", () => {
  const entries: [string, string | null][] = [
    ["z.md", "z"],
    ["a.md", "a"],
    ["m/n.md", "mn"],
  ];
  assertEquals(
    snapshotHash(filesOf([...entries].reverse())),
    snapshotHash(filesOf(entries)),
  );
});

Deno.test("documents/contexts#R20 [ctx-I23]: paths sort by code unit, not by locale or case folding", () => {
  const entries: [string, string | null][] = [
    ["a.md", "1"],
    ["B.md", "2"],
    ["a/b.md", "3"],
  ];
  // 대문자 'B'(0x42)는 소문자 'a'(0x61)보다 앞이고 '.'(0x2e)는 '/'(0x2f)보다 앞이다
  assertEquals(snapshotHash(filesOf(entries)), layout(entries));
});

Deno.test("documents/contexts#R20 [ctx-I23]: one changed byte, a renamed file, or one more file changes the hash", () => {
  const base = snapshotHash(inlineFiles({ "a.md": "abc", "b.md": "def" }));
  assertNotEquals(
    snapshotHash(inlineFiles({ "a.md": "abd", "b.md": "def" })),
    base,
  );
  assertNotEquals(
    snapshotHash(inlineFiles({ "a.md": "abc", "c.md": "def" })),
    base,
  );
  assertNotEquals(
    snapshotHash(inlineFiles({ "a.md": "abc", "b.md": "def", "c.md": "" })),
    base,
  );
  // 내용이 한 파일에서 다른 파일로 옮겨 가도 다르다
  assertNotEquals(
    snapshotHash(inlineFiles({ "a.md": "def", "b.md": "abc" })),
    base,
  );
});

Deno.test("documents/contexts#R20 [ctx-I23]: a listed file that cannot be read differs from an empty file", () => {
  const unreadable = snapshotHash(filesOf([["a.md", null]]));
  assertEquals(unreadable, layout([["a.md", null]]));
  assertNotEquals(unreadable, snapshotHash(filesOf([["a.md", ""]])));
});

Deno.test("documents/contexts#R20 [ctx-I23]: the same snapshot hashes the same every time", () => {
  const entries: [string, string | null][] = [["a.md", "x"], ["b.md", "y"]];
  assertEquals(snapshotHash(filesOf(entries)), snapshotHash(filesOf(entries)));
});
