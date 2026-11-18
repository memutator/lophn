import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import { projectFilesListRead, projectFilesReadRead } from "./mod.ts";

const PROJECT = `prj_0${"1".repeat(25)}`;
const ctx = {} as RequestContext;

async function setup() {
  const base = await mkdtemp(join(tmpdir(), "lophn-files-"));
  const root = join(base, "root");
  const outside = join(base, "outside");
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, "node_modules"));
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "secret");
  await writeFile(join(root, "docs", "a.md"), "# a");
  await writeFile(join(root, "z.txt"), "z");
  await symlink(outside, join(root, "linkdir"));
  await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
  const deps = {
    snapshot: <T>(
      read: (
        sql: { get: () => unknown; all: () => unknown[] },
        seq: string,
      ) => unknown,
    ) =>
      read(
        {
          get: () => ({
            id: PROJECT,
            name: "p",
            title: "p",
            purpose: "",
            revision: "1",
            status: "active",
            identity: null,
            former_identities: "[]",
            repo: null,
            remote_key: null,
            remote_url: null,
          }),
          all: () => [{ position: 0, path: root, description: "" }],
        },
        "1",
      ) as never as T,
  };
  return {
    root,
    list: (path?: string) =>
      projectFilesListRead(deps as never).handle(ctx, {
        project: PROJECT,
        ...(path === undefined ? {} : { path }),
      }),
    read: (path: string) =>
      projectFilesReadRead(deps as never).handle(ctx, {
        project: PROJECT,
        path,
      }),
  };
}

test("project 폴더 밖 path(.., 절대 path, 밖을 가리키는 symlink)는 목록도 읽기도 거절한다", async () => {
  const { list, read } = await setup();
  for (const path of ["../outside", "/etc", "linkdir", "linkdir/secret.txt"]) {
    for (const result of [await list(path), await read(path)]) {
      assert.ok(!result.ok, path);
      assert.equal(result.error.code, "invalid_input", path);
    }
  }
  const read2 = await read("link.txt");
  assert.ok(!read2.ok && read2.error.code === "invalid_input");
  // 목록에도 밖을 가리키는 symlink는 없고, 폴더가 먼저 오며 node_modules는 없다.
  const root = await list();
  assert.ok(root.ok);
  assert.deepEqual(
    root.value.entries.map((entry) => entry.name),
    ["docs", "z.txt"],
  );
});

test("1 MiB를 넘는 file은 글자 경계에서 잘려 오고 truncated가 참이다", async () => {
  const { root, read } = await setup();
  // 한 글자가 3 byte라 1 MiB 경계가 글자 한가운데에 놓인다.
  await writeFile(join(root, "big.txt"), "가".repeat(400_000));
  const big = await read("big.txt");
  assert.ok(big.ok);
  assert.equal(big.value.truncated, true);
  assert.equal(big.value.text, "가".repeat(349_525));
  await writeFile(join(root, "small.txt"), "ok");
  assert.deepEqual(
    (await read("small.txt")) as unknown,
    ok({ text: "ok", truncated: false }),
  );
  await writeFile(join(root, "bin"), new Uint8Array([0, 1, 2]));
  const bin = await read("bin");
  assert.ok(!bin.ok && bin.error.code === "invalid_input");
});
