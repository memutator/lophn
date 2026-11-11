import assert from "node:assert/strict";
import { test } from "node:test";

import { ok } from "../../../../base/mod.ts";
import {
  type AccessState,
  type BrokerAccess,
  currentAccess,
} from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

const state = (release: string): AccessState => ({
  release,
  scope: { access: [], app_calls: [] },
  tools: [],
});

function child(release: string): BrokerChild {
  return { app: "app_1", release, mode: "live", processNonce: `n_${release}` };
}

// 프로세스를 먼저 띄우고 commit으로 release를 active로 잇는다. 시작 코드의 첫 호출은 아직 active가 아닌 자기 release로 오지만,
// 교체된 옛 release의 자식이 새 선언으로 접근을 얻으면 안 된다.
test("activation이 띄운 후보의 시작 코드는 읽기는 받고 쓰기는 unavailable이며 교체된 옛 자식은 받지 못한다", async () => {
  const access: BrokerAccess = {
    // active는 r1. 후보 r2는 release를 지정해야 읽힌다.
    current: (_app, release) => Promise.resolve(ok(state(release ?? "r1"))),
    candidate: (one) => one.processNonce === "n_r2",
  };
  const read = await currentAccess(access, child("r2"), {
    servesCandidate: true,
  });
  assert.equal(read.ok && read.value?.release, "r2");
  // 발행 같은 호출은 core가 active release를 보므로 commit 뒤에 된다. 영구 거절이 아니다.
  const write = await currentAccess(access, child("r2"));
  assert.equal(!write.ok && write.error.code, "unavailable");
  const active = await currentAccess(access, child("r1"));
  assert.equal(active.ok && active.value?.release, "r1");
  // r0은 교체된 release의 자식이다. 후보도 active도 아니다.
  const stale = await currentAccess(access, child("r0"), {
    servesCandidate: true,
  });
  assert.equal(stale.ok && stale.value, null);
});
