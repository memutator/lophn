import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import {
  projectFilesListRead,
  projectFilesMutationHandlers,
  projectFilesReadRead,
} from "./mod.ts";

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
  await symlink(join(root, "z.txt"), join(root, "inside-link.txt"));
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
  const mutations = projectFilesMutationHandlers(deps as never);
  return {
    root,
    outside,
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
    write: (input: { path: string; text: string; base_hash?: string | null }) =>
      mutations.write(ctx as never, { project: PROJECT, ...input }),
    create: (input: { path: string; kind: "file" | "folder" }) =>
      mutations.create(ctx as never, { project: PROJECT, ...input }),
    rename: (input: { from: string; to: string }) =>
      mutations.rename(ctx as never, { project: PROJECT, ...input }),
    remove: (path: string) =>
      mutations.remove(ctx as never, { project: PROJECT, path }),
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
    ["docs", "inside-link.txt", "z.txt"],
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
  assert.equal(big.value.hash, undefined);
  await writeFile(join(root, "small.txt"), "ok");
  const small = await read("small.txt");
  assert.ok(small.ok);
  assert.equal(small.value.text, "ok");
  assert.equal(small.value.truncated, false);
  assert.match(small.value.hash ?? "", /^[0-9a-f]{64}$/);
  assert.ok(typeof small.value.modified_at === "string");
  await writeFile(join(root, "bin"), new Uint8Array([0, 1, 2]));
  const bin = await read("bin");
  assert.ok(!bin.ok && bin.error.code === "invalid_input");
});

test("쓰기·만들기·이름 바꾸기·지우기는 등록 폴더 밖 path와 symlink 탈출·symlink 쓰기를 거절한다", async () => {
  const { outside, write, create, rename, remove } = await setup();
  for (const bad of ["../outside/pwn.txt", "/etc/passwd", "linkdir/pwn.txt"]) {
    const w = await write({ path: bad, text: "x" });
    assert.ok(!w.ok && w.error.code === "invalid_input", `write ${bad}`);
    const c = await create({ path: bad, kind: "file" });
    assert.ok(!c.ok && c.error.code === "invalid_input", `create ${bad}`);
    const r = await remove(bad);
    assert.ok(!r.ok && r.error.code === "invalid_input", `remove ${bad}`);
  }
  // 밖을 가리키는 기존 symlink: 쓰기·지우기는 invalid_input, 만들기는 덮지 않고 conflict다.
  const linkWrite = await write({ path: "link.txt", text: "x" });
  assert.ok(!linkWrite.ok && linkWrite.error.code === "invalid_input");
  const linkCreate = await create({ path: "link.txt", kind: "file" });
  assert.ok(!linkCreate.ok && linkCreate.error.code === "conflict");
  const linkRemove = await remove("link.txt");
  assert.ok(!linkRemove.ok && linkRemove.error.code === "invalid_input");
  // 폴더 안을 가리키는 symlink라도 쓰기는 O_NOFOLLOW 규칙으로 거절한다.
  const symWrite = await write({ path: "inside-link.txt", text: "x" });
  assert.ok(!symWrite.ok && symWrite.error.code === "invalid_input");

  // rename 탈출과 자기 안 이동 거절.
  for (const [from, to] of [
    ["link.txt", "escaped.txt"],
    ["linkdir/secret.txt", "stolen.txt"],
    ["z.txt", "linkdir/moved.txt"],
    ["z.txt", "../outside/moved.txt"],
    ["docs", "docs/sub"],
  ] as const) {
    const mv = await rename({ from, to });
    assert.ok(!mv.ok && mv.error.code === "invalid_input", `${from} -> ${to}`);
  }

  // 1 MiB 상한을 넘는 쓰기는 거절한다.
  const tooBig = await write({
    path: "z.txt",
    text: "a".repeat(1024 * 1024 + 1),
  });
  assert.ok(!tooBig.ok && tooBig.error.code === "invalid_input");

  // 밖 폴더 파일은 그대로 남아 있다.
  assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "secret");
});

test("write의 base_hash 낙관적 잠금과 create·rename·remove 기본 동작과 conflict 규칙", async () => {
  const { root, read, write, create, rename, remove } = await setup();

  // create file & nested folder, 중복은 conflict.
  const createdFile = await create({ path: "notes/hello.md", kind: "file" });
  assert.ok(createdFile.ok);
  const dupFile = await create({ path: "notes/hello.md", kind: "file" });
  assert.ok(!dupFile.ok && dupFile.error.code === "conflict");
  const createdDir = await create({ path: "notes/sub", kind: "folder" });
  assert.ok(createdDir.ok);
  const dupDir = await create({ path: "notes/sub", kind: "folder" });
  assert.ok(!dupDir.ok && dupDir.error.code === "conflict");

  // read -> write with matching base_hash -> mismatch conflict.
  const firstRead = await read("notes/hello.md");
  assert.ok(firstRead.ok && firstRead.value.hash !== undefined);
  const wrote = await write({
    path: "notes/hello.md",
    text: "# hello\n",
    base_hash: firstRead.value.hash,
  });
  assert.ok(wrote.ok);
  assert.equal(
    await readFile(join(root, "notes/hello.md"), "utf8"),
    "# hello\n",
  );

  const stale = await write({
    path: "notes/hello.md",
    text: "stale",
    base_hash: firstRead.value.hash,
  });
  assert.ok(!stale.ok && stale.error.code === "conflict");
  assert.equal(
    await readFile(join(root, "notes/hello.md"), "utf8"),
    "# hello\n",
  );

  // rename & conflict.
  const clash = await rename({ from: "notes/hello.md", to: "z.txt" });
  assert.ok(!clash.ok && clash.error.code === "conflict");
  const moved = await rename({
    from: "notes/hello.md",
    to: "notes/sub/moved.md",
  });
  assert.ok(moved.ok);
  assert.equal(
    await readFile(join(root, "notes/sub/moved.md"), "utf8"),
    "# hello\n",
  );

  // remove folder recursively & not_found on repeat.
  const removed = await remove("notes");
  assert.ok(removed.ok);
  await assert.rejects(stat(join(root, "notes")));
  const missing = await remove("notes");
  assert.ok(!missing.ok && missing.error.code === "not_found");
});
