// documents/file-tracking#R3·R7 (Q15): core가 snapshot에서 읽은 관측 근거를 coordinator에
// 감독 pipe로 보낸다. 같은 snapshot에서 읽고, 바뀐 것만 보내고, 보내기가 실패하면 다음
// 확인이 전체를 다시 보낸다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  parseObservationChunk,
} from "../../packages/documents/file-tracking/mod.ts";
import {
  type BasisRead,
  readObservationBasis,
  watchObservationBasis,
} from "./documents-basis.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const ROOT = {
  root: "/work",
  project: PROJECT,
  project_revision: "2",
  patterns: [{ effect: "include", glob: "**/*.md" }],
  use_gitignore: false,
};

function linkRow(path: string, version = "ver_1") {
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

// 상태가 있는 가짜 reader. seq는 ledger 한 순번이고 links는 경로 순서로 page를 준다.
function reader(state: {
  seq: string;
  links: ReturnType<typeof linkRow>[];
  pageSize?: number;
  bumpDuring?: number;
}): { read: BasisRead; calls: { part: string; after?: string }[] } {
  const calls: { part: string; after?: string }[] = [];
  let linkReads = 0;
  const read: BasisRead = (input) => {
    calls.push(input);
    if (input.part === "roots") {
      return Promise.resolve(
        ok({ roots: [ROOT], as_of_seq: state.seq, next_cursor: null }),
      );
    }
    linkReads += 1;
    const asOf = state.seq;
    // 읽기 도중 ledger가 바뀌는 상황: 첫 page를 준 뒤 seq가 오른다.
    if (state.bumpDuring !== undefined && linkReads === state.bumpDuring) {
      state.seq = String(Number(state.seq) + 1);
    }
    const size = state.pageSize ?? 400;
    const start = input.after === undefined
      ? 0
      : state.links.findIndex((row) => row.path === input.after) + 1;
    const page = state.links.slice(start, start + size);
    return Promise.resolve(ok({
      links: page,
      as_of_seq: asOf,
      next_cursor: start + size < state.links.length ? page.at(-1)!.path : null,
    }));
  };
  return { read, calls };
}

Deno.test("documents/file-tracking#R3: 근거는 root와 연결 page를 같은 snapshot에서 이어 읽는다", async () => {
  const wired = reader({
    seq: "10",
    pageSize: 2,
    links: ["/work/a.md", "/work/b.md", "/work/c.md"].map((path) =>
      linkRow(path)
    ),
  });
  const read = await readObservationBasis(wired.read);
  assert(read.ok);
  assert("payload" in read.value);
  assertEquals(read.value.payload.roots.length, 1);
  assertEquals(read.value.payload.links.length, 3);
  assertEquals(read.value.as_of_seq, "10");
  assertEquals(wired.calls.map((call) => call.part), [
    "roots",
    "links",
    "links",
  ]);
  assertEquals(wired.calls[2].after, "/work/b.md");
});

Deno.test("documents/file-tracking#R3: 읽는 도중 ledger가 바뀌면 처음부터 다시 읽는다", async () => {
  const wired = reader({
    seq: "10",
    pageSize: 1,
    bumpDuring: 1,
    links: ["/work/a.md", "/work/b.md"].map((path) => linkRow(path)),
  });
  const read = await readObservationBasis(wired.read);
  assert(read.ok);
  assert("payload" in read.value);
  // 두 번째 시도는 바뀐 seq 기준으로 끝까지 읽었다.
  assertEquals(read.value.as_of_seq, "11");
  assertEquals(read.value.payload.links.length, 2);
});

Deno.test("documents/file-tracking#R3: ledger가 계속 바뀌어 일관된 읽기를 못 하면 unavailable이다", async () => {
  let seq = 1;
  const read = await readObservationBasis((input) => {
    seq += 1;
    return Promise.resolve(
      input.part === "roots"
        ? ok({ roots: [ROOT], as_of_seq: String(seq), next_cursor: null })
        : ok({ links: [], as_of_seq: String(seq + 100), next_cursor: null }),
    );
  });
  assert(!read.ok);
  assertEquals(read.error.code, "unavailable");
});

Deno.test("documents/file-tracking#R3: 읽기 오류와 모양이 틀린 읽기는 그대로 오류다", async () => {
  const failed = await readObservationBasis(() =>
    Promise.resolve(err({ code: "unavailable", message: "reader down" }))
  );
  assert(!failed.ok);
  const malformed = await readObservationBasis(() =>
    Promise.resolve(ok({ roots: [] }))
  );
  assert(!malformed.ok);
  assertEquals(malformed.error.code, "internal");
});

function sync(
  state: Parameters<typeof reader>[0],
  push: (chunk: unknown) => Promise<Result<unknown>>,
) {
  const wired = reader(state);
  const watch = watchObservationBasis({
    read: wired.read,
    push,
    retryMs: 3_600_000,
  });
  return { watch, wired };
}

Deno.test("documents/file-tracking#R3: 처음에는 전체를 보내고 ledger가 그대로면 다시 읽지도 보내지도 않는다", async () => {
  const pushed: unknown[] = [];
  const { watch, wired } = sync(
    { seq: "10", links: [linkRow("/work/a.md")] },
    (chunk) => {
      pushed.push(chunk);
      return Promise.resolve(ok({ committed: true }));
    },
  );
  try {
    await watch.check();
    assertEquals(pushed.length, 1);
    const chunk = parseObservationChunk(pushed[0]);
    assert(chunk.ok);
    assertEquals(chunk.value.full, true);
    assertEquals(chunk.value.upsert.length, 1);
    const reads = wired.calls.length;
    await watch.check();
    // roots만 한 번 읽어 seq를 비교하고 연결 page는 읽지 않는다.
    assertEquals(wired.calls.length, reads + 1);
    assertEquals(pushed.length, 1);
  } finally {
    watch.stop();
  }
});

Deno.test("documents/file-tracking#R7: 연결이 바뀌면 바뀐 것만 보낸다", async () => {
  const pushed: unknown[] = [];
  const state = {
    seq: "10",
    links: [linkRow("/work/a.md"), linkRow("/work/b.md")],
  };
  const { watch } = sync(state, (chunk) => {
    pushed.push(chunk);
    return Promise.resolve(ok({ committed: true }));
  });
  try {
    await watch.check();
    state.seq = "11";
    state.links = [linkRow("/work/a.md", "ver_2"), linkRow("/work/b.md")];
    await watch.check();
    assertEquals(pushed.length, 2);
    const delta = parseObservationChunk(pushed[1]);
    assert(delta.ok);
    assertEquals(delta.value.full, false);
    assertEquals(delta.value.upsert.map((entry) => entry.path), [
      "/work/a.md",
    ]);
    assertEquals(delta.value.remove, []);
    // seq만 바뀌고 근거가 같으면 보내지 않는다.
    state.seq = "12";
    await watch.check();
    assertEquals(pushed.length, 2);
  } finally {
    watch.stop();
  }
});

Deno.test("documents/file-tracking#R3: 보내기가 실패하면 다음 확인이 처음부터 다시 보낸다", async () => {
  const pushed: unknown[] = [];
  let healthy = false;
  const { watch } = sync(
    { seq: "10", links: [linkRow("/work/a.md")] },
    (chunk) => {
      pushed.push(chunk);
      return Promise.resolve(
        healthy ? ok({ committed: true }) : err({
          code: "unavailable",
          message: "worker down",
        }),
      );
    },
  );
  try {
    await watch.check();
    assertEquals(pushed.length, 1);
    healthy = true;
    await watch.check();
    // seq가 그대로여도 coordinator가 받지 못했으니 다시 읽고 전체를 보낸다.
    assertEquals(pushed.length, 2);
    const retried = parseObservationChunk(pushed[1]);
    assert(retried.ok);
    assertEquals(retried.value.full, true);
  } finally {
    watch.stop();
  }
});

Deno.test("documents/file-tracking#R3: coordinator가 다시 뜨면 invalidate가 근거 전체를 다시 보내게 한다", async () => {
  const pushed: unknown[] = [];
  const { watch } = sync(
    { seq: "10", links: [linkRow("/work/a.md")] },
    (chunk) => {
      pushed.push(chunk);
      return Promise.resolve(ok({ committed: true }));
    },
  );
  try {
    await watch.check();
    watch.invalidate();
    await watch.check();
    assertEquals(pushed.length, 2);
    const again = parseObservationChunk(pushed[1]);
    assert(again.ok);
    assertEquals(again.value.full, true);
  } finally {
    watch.stop();
  }
});

Deno.test("documents/file-tracking#R3: 보내기가 실패하면 주기 읽기 없이 대기 뒤 스스로 전체를 다시 보낸다", async () => {
  const pushed: unknown[] = [];
  let healthy = false;
  const wired = reader({ seq: "10", links: [linkRow("/work/a.md")] });
  const watch = watchObservationBasis({
    read: wired.read,
    push: (chunk) => {
      pushed.push(chunk);
      return Promise.resolve(
        healthy ? ok({ committed: true }) : err({
          code: "unavailable",
          message: "worker down",
        }),
      );
    },
    retryMs: 20,
  });
  try {
    await watch.check();
    assertEquals(pushed.length, 1);
    healthy = true;
    for (let waited = 0; waited < 100 && pushed.length < 2; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assertEquals(pushed.length, 2);
    // 맞춘 뒤에는 timer가 없다: 시간이 가도 다시 읽지 않는다.
    const reads = wired.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assertEquals(wired.calls.length, reads);
  } finally {
    watch.stop();
  }
});

Deno.test("documents/file-tracking#R7: 보내는 도중에 온 신호는 끝난 뒤 한 번 더 확인해 늦은 변화를 놓치지 않는다", async () => {
  const pushed: unknown[] = [];
  const state = { seq: "10", links: [linkRow("/work/a.md")] };
  let release: (() => void) | undefined;
  let gate = new Promise<void>((resolve) => release = resolve);
  const { watch } = sync(state, async (chunk) => {
    pushed.push(chunk);
    await gate;
    return ok({ committed: true });
  });
  try {
    const first = watch.check();
    // 첫 확인이 보내는 동안 연결이 바뀌고 event 신호가 온다.
    await new Promise((resolve) => setTimeout(resolve, 10));
    state.seq = "11";
    state.links = [linkRow("/work/a.md", "ver_2")];
    const second = watch.check();
    gate = Promise.resolve();
    release?.();
    await Promise.all([first, second]);
    assertEquals(pushed.length, 2);
    const delta = parseObservationChunk(pushed[1]);
    assert(delta.ok);
    assertEquals(delta.value.upsert.map((entry) => entry.path), ["/work/a.md"]);
  } finally {
    watch.stop();
  }
});
