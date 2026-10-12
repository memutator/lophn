// documents/file-tracking#R3·R7: coordinator의 관측 근거 store. 조각은 마지막에 한꺼번에
// 반영되고, 끊긴 push는 아무것도 바꾸지 않으며, 늦은 제출은 새 근거를 기다릴 수 있다.
import { assert, assertEquals } from "@std/assert";
import type { ObservationBasisChunk, ObservationLinkBasis } from "../mod.ts";
import { createBasisStore } from "./basis.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";

const ROOT = {
  root: "/work",
  project: PROJECT,
  project_revision: "2",
  patterns: [],
  use_gitignore: false,
};

const FOLDER = { project: PROJECT, path: "/work" };

function link(path: string, version = "ver_1"): ObservationLinkBasis {
  return {
    project: PROJECT,
    path,
    document: "doc_a",
    document_revision: "5",
    status: "active",
    latest_version: version,
    latest_hash: null,
    title: "a",
  };
}

function full(links: ObservationLinkBasis[]): ObservationBasisChunk {
  return {
    begin: true,
    full: true,
    roots: [ROOT],
    folders: [FOLDER],
    upsert: links,
    remove: [],
    more: false,
  };
}

Deno.test("documents/file-tracking#R3: 여러 조각의 push는 마지막 조각에서 한꺼번에 반영된다", () => {
  const store = createBasisStore();
  const first = store.apply({
    begin: true,
    full: true,
    roots: [ROOT],
    folders: [FOLDER],
    upsert: [link("/work/a.md")],
    remove: [],
    more: true,
  });
  assert(first.ok);
  assertEquals(first.value.committed, false);
  assertEquals(store.version, 0);
  assertEquals(store.link("/work/a.md"), undefined);
  const last = store.apply({
    begin: false,
    full: true,
    roots: null,
    folders: null,
    upsert: [link("/work/b.md")],
    remove: [],
    more: false,
  });
  assert(last.ok);
  assertEquals(last.value.committed, true);
  assertEquals(store.version, 1);
  assertEquals(store.roots().length, 1);
  assert(store.link("/work/a.md"));
  assert(store.link("/work/b.md"));
});

Deno.test("documents/file-tracking#R7: 변화 조각은 연결을 바꾸고 지운다", () => {
  const store = createBasisStore();
  store.apply(full([link("/work/a.md"), link("/work/b.md")]));
  store.apply({
    begin: true,
    full: false,
    roots: [ROOT],
    folders: [FOLDER],
    upsert: [link("/work/a.md", "ver_2"), link("/work/c.md")],
    remove: ["/work/b.md"],
    more: false,
  });
  assertEquals(store.link("/work/a.md")?.latest_version, "ver_2");
  assertEquals(store.link("/work/b.md"), undefined);
  assert(store.link("/work/c.md"));
  assertEquals([...store.links()].length, 2);
});

Deno.test("documents/file-tracking#R3: 전체 대체는 옛 연결을 모두 버린다", () => {
  const store = createBasisStore();
  store.apply(full([link("/work/a.md")]));
  store.apply(full([link("/work/z.md")]));
  assertEquals(store.link("/work/a.md"), undefined);
  assert(store.link("/work/z.md"));
});

Deno.test("documents/file-tracking#R3: 시작 없이 온 꼬리 조각은 거절하고 아무것도 바꾸지 않는다", () => {
  const store = createBasisStore();
  store.apply(full([link("/work/a.md")]));
  const tail = store.apply({
    begin: false,
    full: false,
    roots: null,
    folders: null,
    upsert: [link("/work/x.md")],
    remove: ["/work/a.md"],
    more: false,
  });
  assert(!tail.ok);
  assertEquals(tail.error.code, "invalid_input");
  assert(store.link("/work/a.md"));
  assertEquals(store.link("/work/x.md"), undefined);
  assertEquals(store.version, 1);
});

Deno.test("documents/file-tracking#R3: 끊긴 push 뒤 새 begin은 쌓아 둔 옛 조각을 버린다", () => {
  const store = createBasisStore();
  store.apply({
    begin: true,
    full: true,
    roots: [ROOT],
    folders: [FOLDER],
    upsert: [link("/work/stale.md")],
    remove: [],
    more: true,
  });
  store.apply(full([link("/work/fresh.md")]));
  assertEquals(store.link("/work/stale.md"), undefined);
  assert(store.link("/work/fresh.md"));
});

Deno.test("documents/file-tracking#R7: 늦은 제출은 새 근거가 반영되면 깨어나고 기한이 지나면 false다", async () => {
  const store = createBasisStore();
  assertEquals(await store.changedSince(0, 10), false);
  const waiting = store.changedSince(0, 1_000);
  store.apply(full([]));
  assertEquals(await waiting, true);
  // 이미 지난 근거에는 바로 true다.
  assertEquals(await store.changedSince(0, 10), true);
});

Deno.test("documents/file-tracking#R3: 반영될 때마다 구독자를 부르고 해제하면 부르지 않는다", () => {
  const store = createBasisStore();
  let calls = 0;
  const off = store.onCommit(() => calls += 1);
  store.apply(full([]));
  assertEquals(calls, 1);
  off();
  store.apply(full([]));
  assertEquals(calls, 1);
});

Deno.test("documents/file-tracking#R1: store는 관측 root와 쓰기 폴더를 따로 쥔다", () => {
  const store = createBasisStore();
  const off = { project: "prj_01arz3ndektsv4rrffq69g5fax", path: "/off" };
  store.apply({
    begin: true,
    full: true,
    roots: [ROOT],
    folders: [FOLDER, off],
    upsert: [],
    remove: [],
    more: false,
  });
  assertEquals(store.roots().map((root) => root.root), ["/work"]);
  assertEquals(store.folders().map((folder) => folder.path), ["/work", "/off"]);
  // 관측 root가 아닌 폴더는 loop 대상이 아니다.
  assertEquals(store.rootOf("/off"), undefined);
});
