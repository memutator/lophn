// documents/versions#R5: 목록 blob의 준비 참조는 principal·purpose·hash가 같으면 하나라
// (platform/blob-store#R1, 두 번째 준비는 conflict) 같은 목록을 다시 준비하는 파일 되돌림
// (A→B→A)은 살아 있는 준비를 다시 써야 한다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../packages/base/mod.ts";
import type { ContentFile } from "../../packages/contracts/documents/mod.ts";
import type { BlobSink } from "../../packages/documents/file-tracking/stream.ts";
import {
  createListPreparationMemo,
  LIST_PREPARATION_REUSE_MS,
  streamingPrepareFiles,
} from "./documents-prepare.ts";

const FILES: ContentFile[] = [{
  path: "a.md",
  blob_hash: "ab".repeat(32),
  bytes: 4,
  media_type: "text/markdown",
  primary: true,
}];

function countingSink(counter: { prepared: number }, fail = false) {
  return (): BlobSink => ({
    write: () => Promise.resolve(ok(undefined)),
    finish: () => {
      counter.prepared += 1;
      return Promise.resolve(
        fail
          ? err({
            code: "conflict" as const,
            message: "같은 준비 참조가 이미 있다",
          })
          : ok({ preparation: `prep-${counter.prepared}` }),
      );
    },
  });
}

Deno.test("documents/versions#R5: 같은 주체의 같은 목록 hash는 살아 있는 준비를 다시 쓰고 마진 뒤에는 새로 준비한다", async () => {
  let now = 0;
  const memo = createListPreparationMemo(() => now);
  const counter = { prepared: 0 };
  const prepare = (principal: string | undefined) =>
    streamingPrepareFiles(countingSink(counter), { memo, principal })(FILES);
  const first = await prepare("user-1");
  const again = await prepare("user-1");
  assert(first.ok && again.ok);
  assertEquals(again.value, first.value);
  assertEquals(counter.prepared, 1);
  // 다른 주체는 별도 참조다.
  const other = await prepare("user-2");
  assert(other.ok);
  assertEquals(counter.prepared, 2);
  // 주체를 모르면 다시 쓰지 않는다.
  await prepare(undefined);
  await prepare(undefined);
  assertEquals(counter.prepared, 4);
  now = LIST_PREPARATION_REUSE_MS;
  const later = await prepare("user-1");
  assert(later.ok);
  assertEquals(counter.prepared, 5);
});

Deno.test("documents/versions#R5: 실패한 목록 준비는 남기지 않아 다시 시도한다", async () => {
  const memo = createListPreparationMemo(() => 0);
  const counter = { prepared: 0 };
  const failed = await streamingPrepareFiles(countingSink(counter, true), {
    memo,
    principal: "user-1",
  })(FILES);
  assert(!failed.ok);
  const retried = await streamingPrepareFiles(countingSink(counter), {
    memo,
    principal: "user-1",
  })(FILES);
  assert(retried.ok);
  assertEquals(counter.prepared, 2);
});
