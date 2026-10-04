// documents/file-tracking#R5: core 비동기 dispatch는 요청을 큐에 넣고 바로 돌아온다.
// writer·API 처리 흐름은 documents worker의 응답을 기다리지 않는다.
import { assert, assertEquals } from "@std/assert";
import type { Frame } from "../../packages/contracts/platform/mod.ts";
import { createDocumentsDispatch } from "./documents-dispatch.ts";

const request = (id: string) => ({
  request_id: id,
  payload: {
    operation: "scan_batch",
    input_ref: `ref-${id}`,
    basis: {},
  },
  batch: [{ root: "/tmp/root", path: "a.md", observedAt: "t" }],
});

Deno.test("documents/file-tracking#R5: dispatch는 writer가 막혀 있어도 바로 돌아온다", () => {
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const results: string[] = [];
  const dispatch = createDocumentsDispatch({
    writer: {
      write: () => blocked.then(() => 0).then(() => {}),
    },
    onResult: (result) => results.push(result.request_id),
  });
  const started = performance.now();
  dispatch.dispatch(request("req-1"));
  const elapsed = performance.now() - started;
  assert(elapsed < 50, "dispatch 반환이 writer를 기다리지 않는다");
  assertEquals(results, []);
  assertEquals(dispatch.pending, 1);
  release?.();
});

Deno.test("documents/file-tracking#R5: 동시 제출은 한도까지고 나머지는 기다린다", async () => {
  const frames: Frame[] = [];
  const entered: string[] = [];
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const results: string[] = [];
  const dispatch = createDocumentsDispatch({
    writer: {
      write: (frame) => {
        frames.push(frame);
        const id = (frame.kind === "json"
          ? (frame.payload as { request_id?: string }).request_id
          : undefined) ?? "?";
        entered.push(id);
        return gate.then(() => {});
      },
    },
    onResult: (result) =>
      results.push(result.request_id),
    concurrency: 2,
  });
  dispatch.dispatch(request("req-1"));
  dispatch.dispatch(request("req-2"));
  dispatch.dispatch(request("req-3"));
  // 한도 안의 요청이 writer에 닿을 때까지 양보한다.
  for (let step = 0; step < 20 && entered.length < 2; step++) {
    await Promise.resolve();
  }
  // 세 번째 요청은 한도가 비기 전에는 writer에 닿지 않는다.
  assertEquals(entered, ["req-1", "req-2"]);
  assertEquals(dispatch.pending, 3);
  release?.();
  for (let step = 0; step < 20 && results.length < 3; step++) {
    await Promise.resolve();
  }
  assert(frames.length > 2, "한도가 비면 기다리던 요청이 나간다");
  assertEquals(results.length, 3);
  assertEquals(dispatch.pending, 0);
});

Deno.test("documents/file-tracking#R5: writer 실패는 그 요청의 unavailable이다", async () => {
  const results: { id: string; ok: boolean; code?: string }[] = [];
  const dispatch = createDocumentsDispatch({
    writer: { write: () => Promise.reject(new Error("pipe closed")) },
    onResult: (result) =>
      results.push({
        id: result.request_id,
        ok: result.ok,
        code: result.ok ? undefined : result.error.code,
      }),
  });
  dispatch.dispatch(request("req-9"));
  for (let step = 0; step < 20 && results.length < 1; step++) {
    await Promise.resolve();
  }
  assertEquals(results, [{ id: "req-9", ok: false, code: "unavailable" }]);
});

Deno.test("documents/file-tracking#R5: stop은 보내지 못한 요청을 unavailable로 끝낸다", () => {
  const results: { id: string; ok: boolean }[] = [];
  const dispatch = createDocumentsDispatch({
    writer: { write: () => new Promise(() => {}) },
    onResult: (result) =>
      results.push({ id: result.request_id, ok: result.ok }),
    concurrency: 1,
  });
  dispatch.dispatch(request("req-1"));
  dispatch.dispatch(request("req-2"));
  dispatch.stop();
  // 아직 writer에 닿지 않은 요청만 여기서 끝난다. 진행 중 요청은 결과를 만들지 않는다.
  assertEquals(results, [{ id: "req-2", ok: false }]);
  dispatch.dispatch(request("req-3"));
  assertEquals(results.length, 1, "멈춘 dispatch는 새 요청을 받지 않는다");
});
