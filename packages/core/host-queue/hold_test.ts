import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import { createHold } from "./hold.ts";

const SES = "ses_tui" as Id<"ses">;

test("TUI hold는 heartbeat가 이어 주고 끊기면 저절로 풀린다", () => {
  const clock = manualClock(1_700_000_000_000);
  const hold = createHold({ clock });

  // 열 때 30초 예약한다. 확인(heartbeat)이 없으면 30초에 풀린다.
  hold.reserve(SES);
  assert.equal(hold.held(SES), true);
  clock.advance(29_000);
  assert.equal(hold.held(SES), true);
  clock.advance(2_000);
  assert.equal(hold.held(SES), false);

  // heartbeat가 오는 동안 이어지고, 끊기면 10초 뒤 풀린다(shell이 죽은 경우).
  hold.beat([SES]);
  clock.advance(9_000);
  hold.beat([SES]);
  clock.advance(9_000);
  assert.equal(hold.held(SES), true);
  clock.advance(2_000);
  assert.equal(hold.held(SES), false);

  // 목록에 한 번 실렸던 session이 빠지면 바로 풀린다(TUI가 끝났다).
  hold.beat([SES]);
  hold.beat([]);
  assert.equal(hold.held(SES), false);

  // 예약만 하고 아직 목록에 없는 session은 빈 목록에 풀리지 않는다(shell이 터미널을 아직 묶는 중이다).
  hold.reserve(SES);
  hold.beat([]);
  assert.equal(hold.held(SES), true);
});
