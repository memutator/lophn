import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createIdSource, ok, seededRandom } from "../../../base/mod.ts";
import { type CloneDeps, cloneProject } from "./clone.ts";
import { nodeCloneFs } from "./mod.ts";
import type { CloneRun } from "./runner.ts";

const OTHER = "pri_01jzzzzzzzzzzzzzzzzzzzzzzz";
const WANTED = "pri_01aaaaaaaaaaaaaaaaaaaaaaaa";

// 받은 저장소 흉내다. staging 폴더(argv의 끝)에 file을 만들거나 stderr로 실패한다.
function setup(run: (staging: string) => Promise<CloneRun>) {
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
    snapshot: (read) => read({ get: () => undefined, all: () => [] }),
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

test("기대한 id와 다른 저장소는 지워지고 등록되지 않으며, 자격이 박힌 URL은 git을 띄우기 전에 거절된다", async () => {
  const parent = await parentWith();
  const other = setup(async (staging) => {
    await mkdir(staging);
    await writeFile(
      join(staging, ".lophn-project.json"),
      JSON.stringify({ lophn_project: 1, id: OTHER }),
    );
    return { kind: "done", code: 0, stderr: "" };
  });
  const wrong = await cloneProject(
    { url: "git@github.com:a/demo.git", identity: WANTED },
    other.make(parent),
  );
  assert.ok(!wrong.ok);
  assert.equal(wrong.error.details?.["reason"], "different_project");
  assert.equal(wrong.error.details?.["identity"], OTHER);
  assert.deepEqual(await readdir(parent), []);
  assert.equal(other.registered.length, 0);

  for (const url of [
    "https://user:token@github.com/a/demo.git",
    "https://token@github.com/a/demo.git",
    "user:pass@github.com:a/demo.git",
  ]) {
    const refused = await cloneProject({ url }, other.make(parent));
    assert.ok(!refused.ok);
    assert.equal(refused.error.code, "invalid_input");
  }
  assert.equal(other.calls.length, 1);
});
