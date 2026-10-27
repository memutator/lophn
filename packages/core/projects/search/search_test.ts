import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { scan } from "./work.ts";

const deps = { exists: () => true };

async function temp(
  files: Record<string, string>,
): Promise<{ root: string; outside: string }> {
  const base = await mkdtemp(join(tmpdir(), "lophn-search-"));
  const root = join(base, "root");
  const outside = join(base, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "needle outside\n");
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, text);
  }
  return { root, outside };
}

async function run(root: string, query: string, extra = {}) {
  const found = await scan({
    scope: [{ folder_path: root, start: root }],
    query,
    cursor: undefined,
    limit: 100,
    ...extra,
  }, deps);
  assert.ok(found.ok);
  return found.value;
}

test("gitignore가 뺀 파일, .git 안, 연결 폴더 밖으로 나가는 symlink는 결과에 없다", async () => {
  const { root, outside } = await temp({
    ".gitignore": "ignored.txt\nbuild/\n",
    "kept.txt": "needle\n",
    "ignored.txt": "needle\n",
    "build/out.txt": "needle\n",
    "sub/.gitignore": "*.log\n",
    "sub/a.log": "needle\n",
    "sub/b.txt": "needle\n",
    ".git/config": "needle\n",
  });
  await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
  await symlink(outside, join(root, "linkdir"));
  const { matches } = await run(root, "needle");
  assert.deepStrictEqual(matches.map((m) => m.path), [
    "kept.txt",
    "sub/b.txt",
  ]);
});

test("NFC가 다른 한글 질의와 대소문자가 다른 질의도 같은 줄을 찾고 경로 순서 다음 줄 순서로 나온다", async () => {
  const { root } = await temp({
    "b.txt": "x\nHello 한글\n",
    "a/c.txt": "한글 hello\n",
    "a.txt": "none\nHELLO\nhello 또\n",
  });
  const nfd = "한글".normalize("NFD");
  const korean = await run(root, nfd);
  assert.deepStrictEqual(korean.matches.map((m) => [m.path, m.line]), [
    ["a/c.txt", 1],
    ["b.txt", 2],
  ]);
  const first = await run(root, "HeLLo", { limit: 2 });
  assert.deepStrictEqual(first.matches.map((m) => [m.path, m.line]), [
    ["a.txt", 2],
    ["a.txt", 3],
  ]);
  assert.ok(first.next !== null);
  const rest = await run(root, "HeLLo", { cursor: first.next });
  assert.deepStrictEqual(rest.matches.map((m) => [m.path, m.line]), [
    ["a/c.txt", 1],
    ["b.txt", 2],
  ]);
  assert.deepStrictEqual(rest.next, null);
});
