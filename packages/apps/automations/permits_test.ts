import { assertEquals } from "@std/assert";
import { AUTOMATION_CONCURRENCY_LIMIT } from "../../contracts/apps/mod.ts";
import { createAutomationPermits } from "./permits.ts";

const holder = (key: string, nonce = "nonce-1") => ({
  nonce,
  release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
  key,
});

Deno.test("apps/automations#R6: 독립 automation 5개가 동시에 도래하면 4개만 시작하고 대기열이 없다", () => {
  const permits = createAutomationPermits();
  assertEquals(permits.limit, AUTOMATION_CONCURRENCY_LIMIT);
  assertEquals(permits.limit, 4);
  const keys = ["a", "b", "c", "d", "e"];
  const outcomes = keys.map((key) => permits.tryAcquire(holder(key)));
  assertEquals(outcomes, ["granted", "granted", "granted", "granted", "limit"]);
  assertEquals(permits.inUse, 4);
  // 한도 때문에 시작하지 못한 e는 어디에도 쌓이지 않는다. 다른 점유가 돌아와도 e를 자동으로 시작하지
  // 않고 e의 다음 회차가 새로 요청해야 받는다.
  assertEquals(permits.release(holder("a")), true);
  assertEquals(permits.inUse, 3);
  assertEquals(permits.tryAcquire(holder("e")), "granted");
});

Deno.test("apps/automations#R6: permit은 실제 handler 종료나 자식 종료 확인 때만 돌아오고 같은 automation은 둘을 못 쥔다", () => {
  const permits = createAutomationPermits();
  assertEquals(permits.tryAcquire(holder("a")), "granted");
  assertEquals(permits.tryAcquire(holder("a")), "busy");
  // 다른 자식이 같은 key로 풀어도 풀리지 않는다.
  assertEquals(permits.release(holder("a", "nonce-2")), false);
  assertEquals(permits.inUse, 1);
  assertEquals(permits.tryAcquire(holder("b")), "granted");
  assertEquals(permits.tryAcquire(holder("a", "nonce-2")), "granted");
  assertEquals(permits.inUse, 3);
  // 자식 종료 확인은 그 자식의 점유를 모두 푼다.
  assertEquals(permits.childExited("nonce-1"), 2);
  assertEquals(permits.inUse, 1);
  // 이미 푼 점유의 반납은 아무것도 바꾸지 않는다.
  assertEquals(permits.release(holder("a")), false);
  assertEquals(permits.childExited("nonce-1"), 0);
  assertEquals(permits.inUse, 1);
});
