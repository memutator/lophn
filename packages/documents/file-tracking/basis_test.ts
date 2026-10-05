// documents/file-tracking#R3·R7: core가 coordinator에 넘기는 관측 근거(Q15)의 모양 검사,
// 변화만 보내는 조각 나누기, root loop를 다시 시작해야 하는 key.
import { assert, assertEquals } from "@std/assert";
import {
  chunkObservationBasis,
  type ObservationBasisPayload,
  type ObservationLinkBasis,
  parseObservationBasis,
  parseObservationChunk,
  rootSignature,
} from "./basis.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";

const ROOT = {
  root: "/work",
  project: PROJECT,
  project_revision: "2",
  patterns: [{ effect: "include" as const, glob: "**/*.md" }],
  use_gitignore: false,
};

function link(path: string, version = "ver_1"): ObservationLinkBasis {
  return {
    project: PROJECT,
    path,
    document: "doc_a",
    document_revision: "5",
    status: "active",
    latest_version: version,
    latest_hash: "ab".repeat(32),
    title: "a",
  };
}

Deno.test("documents/file-tracking#R3: 관측 근거는 모양이 틀리면 일부만 받지 않고 통째로 거절한다", () => {
  const good = parseObservationBasis({
    roots: [ROOT],
    links: [link("/work/a.md")],
  });
  assert(good.ok);
  const badPattern = parseObservationBasis({
    roots: [{ ...ROOT, patterns: [{ effect: "allow", glob: "*" }] }],
    links: [],
  });
  assert(!badPattern.ok);
  const badLink = parseObservationBasis({
    roots: [ROOT],
    links: [link("/work/a.md"), { ...link("/work/b.md"), status: "gone" }],
  });
  assert(!badLink.ok);
  assert(!parseObservationBasis({ roots: [] }).ok);
  assert(!parseObservationBasis(null).ok);
});

Deno.test("documents/file-tracking#R3: 조각은 begin이면 root가 있고 아니면 root가 없다", () => {
  const begin = parseObservationChunk({
    begin: true,
    full: true,
    roots: [ROOT],
    upsert: [link("/work/a.md")],
    remove: [],
    more: false,
  });
  assert(begin.ok);
  const rootlessBegin = parseObservationChunk({
    begin: true,
    full: true,
    roots: null,
    upsert: [],
    remove: [],
    more: false,
  });
  assert(!rootlessBegin.ok);
  const rootedTail = parseObservationChunk({
    begin: false,
    full: true,
    roots: [ROOT],
    upsert: [],
    remove: [],
    more: false,
  });
  assert(!rootedTail.ok);
  // 전체 대체는 지울 경로를 말하지 않는다.
  const fullWithRemove = parseObservationChunk({
    begin: true,
    full: true,
    roots: [],
    upsert: [],
    remove: ["/work/a.md"],
    more: false,
  });
  assert(!fullWithRemove.ok);
});

Deno.test("documents/file-tracking#R3: 처음 보내는 근거는 전체 대체 조각이고 바뀐 것이 없으면 보내지 않는다", () => {
  const payload: ObservationBasisPayload = {
    roots: [ROOT],
    links: [link("/work/a.md"), link("/work/b.md")],
  };
  const first = chunkObservationBasis(undefined, payload);
  assertEquals(first.length, 1);
  assertEquals(first[0].begin, true);
  assertEquals(first[0].full, true);
  assertEquals(first[0].upsert.length, 2);
  assertEquals(first[0].more, false);
  assertEquals(chunkObservationBasis(payload, payload), []);
});

Deno.test("documents/file-tracking#R7: 연결이 바뀌면 바뀐 연결과 사라진 경로만 보낸다", () => {
  const before: ObservationBasisPayload = {
    roots: [ROOT],
    links: [link("/work/a.md"), link("/work/b.md")],
  };
  const after: ObservationBasisPayload = {
    roots: [ROOT],
    links: [link("/work/a.md", "ver_2"), link("/work/c.md")],
  };
  const chunks = chunkObservationBasis(before, after);
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].full, false);
  assertEquals(chunks[0].upsert.map((entry) => entry.path), [
    "/work/a.md",
    "/work/c.md",
  ]);
  assertEquals(chunks[0].remove, ["/work/b.md"]);
});

Deno.test("documents/file-tracking#R3: root·규칙만 바뀌어도 root가 담긴 조각을 보낸다", () => {
  const before: ObservationBasisPayload = { roots: [ROOT], links: [] };
  const after: ObservationBasisPayload = {
    roots: [{ ...ROOT, project_revision: "3" }],
    links: [],
  };
  const chunks = chunkObservationBasis(before, after);
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].roots?.[0].project_revision, "3");
  assertEquals(chunks[0].upsert, []);
});

Deno.test("documents/file-tracking#R3: 조각은 제어 frame 상한 아래로 나뉘고 마지막 조각만 more가 꺼져 있다", () => {
  const links = Array.from({ length: 50 }, (_, index) => ({
    ...link(`/work/${String(index).padStart(3, "0")}.md`),
    title: "t".repeat(400),
  }));
  const chunks = chunkObservationBasis(
    undefined,
    { roots: [ROOT], links },
    8 * 1024,
  );
  assert(chunks.length > 1);
  assertEquals(chunks.map((chunk) => chunk.begin), [
    true,
    ...chunks.slice(1).map(() => false),
  ]);
  assertEquals(chunks.map((chunk) => chunk.more), [
    ...chunks.slice(1).map(() => true),
    false,
  ]);
  for (const chunk of chunks) {
    assert(
      new TextEncoder().encode(JSON.stringify(chunk)).length < 12 * 1024,
    );
    assert(parseObservationChunk(chunk).ok);
  }
  assertEquals(
    chunks.flatMap((chunk) => chunk.upsert).map((entry) => entry.path),
    links.map((entry) => entry.path),
  );
});

Deno.test("documents/file-tracking#R8: root 관측 key는 규칙·project 판·보관된 연결이 바뀌면 달라진다", () => {
  const base = rootSignature(ROOT, []);
  assertEquals(base, rootSignature(ROOT, []));
  assert(base !== rootSignature({ ...ROOT, project_revision: "3" }, []));
  assert(base !== rootSignature({ ...ROOT, use_gitignore: true }, []));
  assert(
    base !== rootSignature({
      ...ROOT,
      patterns: [{ effect: "exclude", glob: "**/*.md" }],
    }, []),
  );
  // 보관이 풀리면(archived 경로 목록이 줄면) 그 root를 다시 대조한다.
  assert(base !== rootSignature(ROOT, ["/work/old.md"]));
  assertEquals(
    rootSignature(ROOT, ["/work/b.md", "/work/a.md"]),
    rootSignature(ROOT, ["/work/a.md", "/work/b.md"]),
  );
});
