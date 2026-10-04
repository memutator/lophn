// release 준비 상한(apps/releases#R3, R19). source 64MiB·bundle 256MiB·10000파일·
// 300000ms 각각을 넘기면 실패 이유가 남고 부분 bundle은 확정되지 않는다(R19).
// 준비 중 source 변경이면 source_changed로 취소다(R3).
import { assert, assertEquals } from "@std/assert";
import {
  checkLimits,
  exceededLimit,
  RELEASE_BUNDLE_MAX_BYTES,
  RELEASE_FILE_MAX_COUNT,
  RELEASE_PREPARATION_LIMIT_MS,
  RELEASE_SOURCE_MAX_BYTES,
} from "./limits.ts";
import { checkPin, observeSourceChanged, pinSource } from "./source-watch.ts";

const UNDER = {
  source_bytes: RELEASE_SOURCE_MAX_BYTES,
  bundle_bytes: RELEASE_BUNDLE_MAX_BYTES,
  file_count: RELEASE_FILE_MAX_COUNT,
  elapsed_ms: RELEASE_PREPARATION_LIMIT_MS,
};

Deno.test("apps/releases#R19: source 64MiB를 넘기면 bundle 없이 실패 이유가 남는다", () => {
  // 64MiB 한 바이트 넘은 source. 부분 bundle은 만들지 않는다(R19).
  const refused = checkLimits({
    ...UNDER,
    source_bytes: RELEASE_SOURCE_MAX_BYTES + 1,
  });
  assertEquals(refused.ok, false);
  if (!refused.ok) {
    assertEquals(refused.error.reason, "source_bytes");
    assertEquals(refused.error.limit, RELEASE_SOURCE_MAX_BYTES);
    assertEquals(refused.error.observed, RELEASE_SOURCE_MAX_BYTES + 1);
  }
});

Deno.test("apps/releases#R19: bundle 256MiB와 10000파일을 넘기면 거절이다", () => {
  // bundle 크기 초과. 관측값과 상한이 실패 이유에 남는다.
  const big = checkLimits({
    ...UNDER,
    bundle_bytes: RELEASE_BUNDLE_MAX_BYTES + 1,
  });
  assertEquals(big.ok, false);
  if (!big.ok) assertEquals(big.error.reason, "bundle_bytes");
  // 파일 수 초과.
  const many = checkLimits({
    ...UNDER,
    file_count: RELEASE_FILE_MAX_COUNT + 1,
  });
  assertEquals(many.ok, false);
  if (!many.ok) assertEquals(many.error.reason, "file_count");
  // 상한 안이면 통과다.
  const fine = checkLimits(UNDER);
  assert(fine.ok);
  assertEquals(fine.value.usage, UNDER);
});

Deno.test("apps/releases#R19: 300000ms를 넘기면 거절이다", () => {
  // 준비 기한 초과. elapsed_ms 초과는 실패 이유 하나다.
  const late = checkLimits({
    ...UNDER,
    elapsed_ms: RELEASE_PREPARATION_LIMIT_MS + 1,
  });
  assertEquals(late.ok, false);
  if (!late.ok) {
    assertEquals(late.error.reason, "elapsed_ms");
    assertEquals(late.error.limit, RELEASE_PREPARATION_LIMIT_MS);
  }
  // 경계값은 통과다. 초과가 아니라 같으면 통과해야 한다.
  assertEquals(exceededLimit(UNDER), undefined);
});

Deno.test("apps/releases#R3: 준비 중 source 변경은 source_changed 취소다", async () => {
  // 준비 시작 때 pin을 한 번 고정한다.
  const pinned = pinSource("commit-one");
  assertEquals(pinned, "commit-one");
  // 같은 pin이면 계속한다.
  const same = checkPin(pinned, "commit-one");
  assert(same.ok);
  assertEquals(same.value.changed, false);
  // 도중 관측이 pin과 다르면 source_changed다.
  const moved = checkPin(pinned, "commit-two");
  assertEquals(moved.ok, false);
  // observe 기반 감시도 같은 규칙이다.
  const watched = await observeSourceChanged({
    pinned,
    observe: () => Promise.resolve("commit-two"),
  });
  assertEquals(watched, true);
  const steady = await observeSourceChanged({
    pinned,
    observe: () => Promise.resolve("commit-one"),
  });
  assertEquals(steady, false);
});
