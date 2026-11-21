import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createIdSource, ok, seededRandom } from "../../../base/mod.ts";
import { type CloneDeps, cloneProject } from "./clone.ts";
import { nodeCloneFs } from "./mod.ts";
import type { CloneRun } from "./runner.ts";

const WANTED = "pri_01aaaaaaaaaaaaaaaaaaaaaaaa";

// 받은 저장소 흉내다. staging 폴더(argv의 끝)에 file을 만들거나 stderr로 실패한다.
// held: 그 id를 옛 identity로 가진 이 기계의 project.
function setup(
  run: (staging: string) => Promise<CloneRun>,
  held: string | null = null,
) {
  const calls: string[][] = [];
  const registered: unknown[] = [];
  const logger = {
    log() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    flush: () => Promise.resolve(),
  };
  const make = (parent: string): CloneDeps => ({
    git: ({ argv }) => {
      calls.push([...argv]);
      return run(argv.at(-1)!);
    },
    fs: nodeCloneFs,
    ids: createIdSource({
      clock: { nowMs: () => 1, now: () => "1970-01-01T00:00:00.001Z" },
      random: seededRandom(1),
    } as never),
    random: seededRandom(2),
    writer: {
      command: (_ctx, envelope) => {
        registered.push(envelope.input);
        return Promise.resolve(ok({ result: { id: "prj_x" } } as never));
      },
    },
    snapshot: (read) =>
      read({
        get: (query: string) =>
          held !== null && query.includes("former_identities")
            ? { id: held }
            : undefined,
        all: () => [],
      } as never),
    settings: { folder: () => parent, remember: () => Promise.resolve() },
    logger,
  });
  return { calls, registered, make };
}

async function parentWith(files: Record<string, string> = {}) {
  const parent = await mkdtemp(join(tmpdir(), "lophn-clone-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(parent, path, ".."), { recursive: true });
    await writeFile(join(parent, path), text);
  }
  return parent;
}

test("대상 폴더가 있으면 그 안에 아무것도 쓰지 않고 conflict이며, 실패한 clone은 부모 폴더에 아무것도 남기지 않는다", async () => {
  const parent = await parentWith({ "demo/keep.txt": "mine" });
  const here = setup(() =>
    Promise.resolve({ kind: "done", code: 0, stderr: "" }),
  );
  const exists = await cloneProject(
    { url: "https://github.com/a/demo.git" },
    here.make(parent),
  );
  assert.ok(!exists.ok);
  assert.equal(exists.error.code, "conflict");
  assert.equal(exists.error.details?.["reason"], "target_exists");
  assert.equal(here.calls.length, 0);
  assert.deepEqual(await readdir(join(parent, "demo")), ["keep.txt"]);
  assert.equal(await readFile(join(parent, "demo/keep.txt"), "utf8"), "mine");

  // git이 받다가 file을 만들고 실패한다.
  const failing = setup(async (staging) => {
    await mkdir(staging);
    await writeFile(join(staging, "half"), "x");
    return {
      kind: "done",
      code: 128,
      stderr: "fatal: could not read Username for 'https://github.com'\n",
    };
  });
  const failed = await cloneProject(
    { url: "https://github.com/a/other.git" },
    failing.make(parent),
  );
  assert.ok(!failed.ok);
  assert.equal(failed.error.details?.["reason"], "git_auth");
  assert.equal(failed.error.details?.["command"], "gh auth login");
  assert.deepEqual(await readdir(parent), ["demo"]);
  assert.equal(failing.registered.length, 0);
});

test("들고 온 id로 등록하고, 그 id를 이 기계의 다른 project가 옛 identity로 가지면 git을 띄우지 않고 거절하며, 자격이 박힌 URL은 git을 띄우기 전에 거절된다", async () => {
  const parent = await parentWith();
  const done = setup(async (staging) => {
    await mkdir(staging);
    return { kind: "done", code: 0, stderr: "" };
  });
  const cloned = await cloneProject(
    { url: "git@github.com:a/demo.git", identity: WANTED },
    done.make(parent),
  );
  assert.ok(cloned.ok);
  assert.equal((done.registered[0] as { identity?: string }).identity, WANTED);

  const held = setup(() => {
    throw new Error("git must not run");
  }, "prj_00000000000000000000000009");
  const refused = await cloneProject(
    { url: "git@github.com:a/again.git", identity: WANTED },
    held.make(parent),
  );
  assert.ok(!refused.ok);
  assert.equal(refused.error.details?.["reason"], "identity_in_use");
  assert.equal(held.calls.length, 0);
  assert.deepEqual(await readdir(parent), ["demo"]);

  for (const url of [
    "https://user:token@github.com/a/demo.git",
    "https://token@github.com/a/demo.git",
    "user:pass@github.com:a/demo.git",
  ]) {
    const bad = await cloneProject({ url }, done.make(parent));
    assert.ok(!bad.ok);
    assert.equal(bad.error.code, "invalid_input");
  }
  assert.equal(done.calls.length, 1);
});
