import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock } from "../../../../base/mod.ts";
import { createFolderLanes, type RunOutcome } from "./folder-lanes.ts";

// 지우면 core를 다시 켠 뒤 앱이 뜨기 전에 한 첫 내보내기가 물러난 채 몇 분을 기다려, 이미 뜬 앱의 data가 늦게 나간다. 다른
// 오류의 물러남까지 지우면 막힌 폴더에 앱이 뜰 때마다 다시 쓰려 든다.
test("앱이 없어서 물러난 lane만 앱이 뜬 신호에 바로 한 번 다시 돌고, 다른 오류로 물러난 lane은 그대로 기다린다", async () => {
  const clock = manualClock(Date.parse("2026-11-22T00:00:00.000Z"));
  const work = new Set<Promise<void>>();
  const lanes = createFolderLanes({
    nowMs: () => clock.nowMs(),
    stopped: () => false,
    log: () => {},
    track: (done) => work.add(done),
  });
  const settle = async () => {
    await Promise.all(work);
    work.clear();
  };
  const runs = { down: 0, other: 0 };
  let appUp = false;
  const exportJob = (): Promise<RunOutcome> => {
    runs.down += 1;
    return Promise.resolve(
      appUp
        ? { ok: true, more: false }
        : { ok: false, more: false, appDown: true },
    );
  };
  const otherJob = (): Promise<RunOutcome> => {
    runs.other += 1;
    return Promise.resolve({ ok: false, more: false });
  };

  lanes.kick("export:app_1:personal", exportJob);
  lanes.kick("export:app_1:drive", otherJob);
  await settle();
  assert.deepEqual(runs, { down: 1, other: 1 });
  // 물러나는 동안 다시 불러도 돌지 않는다.
  lanes.kick("export:app_1:personal", exportJob);
  lanes.kick("export:app_1:drive", otherJob);
  await settle();
  assert.deepEqual(runs, { down: 1, other: 1 });

  appUp = true;
  lanes.appReady(["export:app_1:"]);
  await settle();
  assert.deepEqual(runs, { down: 2, other: 1 });
  // 다시 돌아 성공했으니 물러남이 없다. 다른 lane은 물러난 그대로다.
  lanes.kick("export:app_1:personal", exportJob);
  lanes.kick("export:app_1:drive", otherJob);
  await settle();
  assert.deepEqual(runs, { down: 3, other: 1 });
});
