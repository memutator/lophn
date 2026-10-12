// 감독이 포기한 documents coordinator를 core가 다시 띄우는 규칙: backoff, core 시작마다의 한도,
// 한 번만 알림, 종료. 실제 process 없이 시험이 대기와 결과를 직접 정한다.
import { assert, assertEquals } from "@std/assert";
import { createDocumentsRespawner } from "./respawn.ts";

async function until(ready: () => boolean) {
  for (let i = 0; i < 400 && !ready(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert(ready());
}

Deno.test("platform/responsiveness#R3: 포기한 coordinator는 backoff(두 배씩, 상한)로 한 번에 하나씩 다시 띄우고 뜨면 멈춘다", async () => {
  const waits: number[] = [];
  let attempts = 0;
  const respawner = createDocumentsRespawner({
    baseMs: 250,
    maxMs: 800,
    limit: 6,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    respawn: () => {
      attempts += 1;
      return Promise.resolve(attempts === 4);
    },
  });
  respawner.giveUp("restart limit reached");
  // 이미 다시 띄우는 중이면 겹쳐 돌지 않는다.
  respawner.giveUp("restart limit reached");
  await until(() => attempts === 4);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(waits, [250, 500, 800, 800]);
  assertEquals(attempts, 4);
  assertEquals(respawner.used, 4);
});

Deno.test("platform/responsiveness#R3: 한도를 넘으면 더 띄우지 않고 한 번만 알리며, 던진 시도도 실패로 센다", async () => {
  const exhausted: string[] = [];
  let attempts = 0;
  const respawner = createDocumentsRespawner({
    limit: 3,
    sleep: () => Promise.resolve(),
    respawn: () => {
      attempts += 1;
      return Promise.reject(new Error("boom"));
    },
    onExhausted: (reason) => exhausted.push(reason),
  });
  respawner.giveUp("ready timed out");
  await until(() => exhausted.length === 1);
  assertEquals(attempts, 3);
  // 한도 뒤의 포기는 다시 띄우지 않고 다시 알리지도 않는다.
  respawner.giveUp("ready timed out");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assertEquals(attempts, 3);
  assertEquals(exhausted, ["ready timed out"]);
});

Deno.test("platform/responsiveness#R3: 종료하면 대기 중인 다시 띄움을 하지 않고 대기 timer도 남기지 않는다", async () => {
  let attempts = 0;
  const respawner = createDocumentsRespawner({
    baseMs: 60_000,
    respawn: () => {
      attempts += 1;
      return Promise.resolve(true);
    },
  });
  respawner.giveUp("restart limit reached");
  await new Promise((resolve) => setTimeout(resolve, 20));
  respawner.stop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(attempts, 0);
  // 종료한 뒤의 포기는 무시한다.
  respawner.giveUp("restart limit reached");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(attempts, 0);
});
