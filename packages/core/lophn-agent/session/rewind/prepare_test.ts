import { assert, assertEquals } from "@std/assert";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { JudgedFile } from "./judge.ts";
import {
  installRedo,
  installRestore,
  observeFiles,
  prepareRestore,
} from "./prepare.ts";
import { createRewindStore } from "./store.ts";
import {
  readProjectFile,
  SES,
  sha256,
  tempDir,
  writeProjectFile,
} from "./testing/mod.ts";

// 문서 파일 복원의 관측·준비·설치(agent-RW3b). 임시 project 폴더와 임시 저장소의 실제 파일을 쓴다.

const encode = (text: string) => new TextEncoder().encode(text);

function listing(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      } else out.push(`${prefix}${entry.name}`);
    }
  };
  walk(root, "");
  return out.sort();
}

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: observeFiles reports hash, absence, symlinks and hard links", () => {
  const root = tempDir("project");
  writeProjectFile(root, "plain.md", "text");
  writeProjectFile(root, "target.md", "linked");
  symlinkSync(join(root, "target.md"), join(root, "sym.md"));
  writeProjectFile(root, "hard-a.md", "shared");
  linkSync(join(root, "hard-a.md"), join(root, "hard-b.md"));
  const seen = observeFiles(root, [
    "plain.md",
    "missing.md",
    "sym.md",
    "hard-a.md",
    "hard-b.md",
  ]);
  assertEquals(seen.get("plain.md"), {
    exists: true,
    sha256: sha256("text"),
    link: false,
  });
  assertEquals(seen.get("missing.md"), {
    exists: false,
    sha256: null,
    link: false,
  });
  assertEquals(seen.get("sym.md")!.link, true);
  assertEquals(seen.get("hard-a.md")!.link, true);
  assertEquals(seen.get("hard-b.md")!.link, true);
});

async function setup() {
  const root = tempDir("project");
  const store = createRewindStore(tempDir("data"));
  const old = await store.put(SES, encode("old text"));
  const judged: JudgedFile[] = [
    {
      path: "dir/a.md",
      source: ["tcl_1"],
      plan: "restore",
      reason: null,
      actions: [{
        kind: "write",
        path: "dir/a.md",
        sha256: old.key,
        blob: old.key,
      }],
      restored_sha256: old.key,
    },
    {
      path: "created.md",
      source: ["tcl_2"],
      plan: "restore",
      reason: null,
      actions: [{ kind: "delete", path: "created.md" }],
      restored_sha256: null,
    },
    {
      path: "human.md",
      source: ["tcl_3"],
      plan: "skip",
      reason: "edited_outside",
      actions: [],
      restored_sha256: null,
    },
  ];
  writeProjectFile(root, "dir/a.md", "agent text");
  writeProjectFile(root, "created.md", "agent made this");
  writeProjectFile(root, "human.md", "person text");
  return { root, store, judged };
}

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: prepareRestore covers every judged path and keeps the current content for redo", async () => {
  const { root, store, judged } = await setup();
  const current = observeFiles(root, judged.map((file) => file.path));
  const prepared = await prepareRestore({
    root,
    store,
    session: SES,
    judged,
    current,
    keepRedo: true,
  });
  assertEquals(prepared.map((file) => file.path).sort(), [
    "created.md",
    "dir/a.md",
    "human.md",
  ]);
  const byPath = new Map(prepared.map((file) => [file.path, file]));
  const a = byPath.get("dir/a.md")!;
  assertEquals(a.observed_sha256, sha256("agent text"));
  assertEquals(a.staged, true);
  // 복원 직전 내용을 redo 근거로 저장소에 둔다.
  assertEquals(a.redo_ref, sha256("agent text"));
  assertEquals(await store.read(SES, a.redo_ref!), encode("agent text"));
  // 지우는 동작은 pre-image가 없어 staged가 아니지만 redo 내용은 둔다.
  assertEquals(byPath.get("created.md")!.staged, false);
  assertEquals(byPath.get("created.md")!.redo_ref, sha256("agent made this"));
  // 건너뛰는 파일은 관측만 하고 아무것도 두지 않는다.
  const human = byPath.get("human.md")!;
  assertEquals([human.observed_sha256, human.staged, human.redo_ref], [
    sha256("person text"),
    false,
    null,
  ]);
  assert(!(await store.has(SES, sha256("person text"))));
});

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: without keepRedo nothing is copied for redo", async () => {
  const { root, store, judged } = await setup();
  const prepared = await prepareRestore({
    root,
    store,
    session: SES,
    judged,
    current: observeFiles(root, judged.map((file) => file.path)),
    keepRedo: false,
  });
  assertEquals(prepared.map((file) => file.redo_ref), [null, null, null]);
  assert(!(await store.has(SES, sha256("agent text"))));
});

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: installRestore replaces, deletes and leaves skipped files and no temp file behind", async () => {
  const { root, store, judged } = await setup();
  const prepared = await prepareRestore({
    root,
    store,
    session: SES,
    judged,
    current: observeFiles(root, judged.map((file) => file.path)),
    keepRedo: false,
  });
  const results = await installRestore({
    root,
    store,
    session: SES,
    judged,
    prepared,
  });
  assertEquals(
    results.map((result) => [result.path, result.result]).sort(),
    [["created.md", "restored"], ["dir/a.md", "restored"]],
  );
  assertEquals(readProjectFile(root, "dir/a.md"), "old text");
  assert(!existsSync(join(root, "created.md")));
  assertEquals(readProjectFile(root, "human.md"), "person text");
  assertEquals(listing(root), ["dir/a.md", "human.md"]);
});

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: a file changed after it was prepared is re-compared and not overwritten", async () => {
  const { root, store, judged } = await setup();
  const prepared = await prepareRestore({
    root,
    store,
    session: SES,
    judged,
    current: observeFiles(root, judged.map((file) => file.path)),
    keepRedo: false,
  });
  // 준비와 설치 사이에 사람이 고친다.
  writeFileSync(join(root, "dir/a.md"), "edited just now");
  const results = await installRestore({
    root,
    store,
    session: SES,
    judged,
    prepared,
  });
  assertEquals(
    results.find((result) => result.path === "dir/a.md")!.result,
    "skipped",
  );
  assertEquals(readProjectFile(root, "dir/a.md"), "edited just now");
  assertEquals(
    results.find((result) => result.path === "created.md")!.result,
    "restored",
  );
});

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: installRestore brings a deleted file back, creating its folder", async () => {
  const root = tempDir("project");
  const store = createRewindStore(tempDir("data"));
  const body = await store.put(SES, encode("lost body"));
  const judged: JudgedFile[] = [{
    path: "deep/er/gone.md",
    source: ["tcl_1"],
    plan: "restore",
    reason: null,
    actions: [{
      kind: "write",
      path: "deep/er/gone.md",
      sha256: body.key,
      blob: body.key,
    }],
    restored_sha256: body.key,
  }];
  mkdirSync(root, { recursive: true });
  const prepared = await prepareRestore({
    root,
    store,
    session: SES,
    judged,
    current: observeFiles(root, ["deep/er/gone.md"]),
    keepRedo: true,
  });
  assertEquals(prepared[0]!.observed_sha256, null);
  assertEquals(prepared[0]!.redo_ref, null);
  await installRestore({ root, store, session: SES, judged, prepared });
  assertEquals(readProjectFile(root, "deep/er/gone.md"), "lost body");
});

Deno.test("lophn-agent/revert#R16 [agent-RW3b]: installRedo rewrites only the files still holding what the rewind restored", async () => {
  const root = tempDir("project");
  const store = createRewindStore(tempDir("data"));
  const redoA = await store.put(SES, encode("agent version of a"));
  const redoB = await store.put(SES, encode("agent version of b"));
  writeProjectFile(root, "a.md", "restored a");
  writeProjectFile(root, "b.md", "person edited b after the rewind");
  writeProjectFile(root, "c.md", "restored c");
  const results = await installRedo({
    root,
    store,
    session: SES,
    entries: [
      {
        path: "a.md",
        restored_sha256: sha256("restored a"),
        redo_ref: redoA.key,
      },
      {
        path: "b.md",
        restored_sha256: sha256("restored b"),
        redo_ref: redoB.key,
      },
      // rewind가 지웠던 파일(restored_sha256 null)이 다시 만들어졌다면 그대로 둔다.
      { path: "c.md", restored_sha256: null, redo_ref: redoA.key },
    ],
  });
  assertEquals(readProjectFile(root, "a.md"), "agent version of a");
  assertEquals(
    readProjectFile(root, "b.md"),
    "person edited b after the rewind",
  );
  assertEquals(readProjectFile(root, "c.md"), "restored c");
  assertEquals(
    results.map((result) => [result.path, result.result]).sort(),
    [["a.md", "restored"], ["b.md", "skipped"], ["c.md", "skipped"]],
  );
  assertEquals(listing(root), ["a.md", "b.md", "c.md"]);
});

Deno.test("lophn-agent/revert#R16 [agent-RW3b]: installRedo removes a file the agent had deleted when redo_ref is empty", async () => {
  const root = tempDir("project");
  const store = createRewindStore(tempDir("data"));
  writeProjectFile(root, "back.md", "brought back");
  await installRedo({
    root,
    store,
    session: SES,
    entries: [{
      path: "back.md",
      restored_sha256: sha256("brought back"),
      redo_ref: null,
    }],
  });
  assert(!existsSync(join(root, "back.md")));
});
