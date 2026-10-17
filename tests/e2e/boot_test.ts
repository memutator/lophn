// 세 질문
// - contract: boundary `server`·`supervision`(user token은 parent pipe hello 한 번으로만 나오고 data root가 격리된다).
// - 현실적 회귀: hello frame 모양이나 권한 flag가 바뀌어 모든 E2E가 못 도는 것, 실행 폴더가 사람의 data root를
//   가리키는 것, 읽기 전용 sdk 사본 때문에 지우기가 실패해 .dev-data가 쌓이는 것.
// - 왜 지금 test로 못 잡나: core를 daemon으로 띄워 token을 받는 test가 없다(sandbox-boundary_test는 subprocess 한 번).
import { assert, assertEquals, assertRejects } from "@std/assert";
import { platformStatus } from "../../packages/protocol/server/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { processesOf } from "../support/core/process.ts";

Deno.test("E2E core는 실행 폴더의 data root만 쓰고, 정리하면 흔적이 남지 않는다", async () => {
  const run = await createRun();
  let core: Core | undefined;
  const statuses = [];
  try {
    core = await bootCore(run);
    statuses.push(await core.call(platformStatus, {}));
    await core.kill();
    // SIGKILL 뒤 instance lock과 schema가 재기동을 막지 않아야 한다.
    core = await bootCore(run);
    statuses.push(await core.call(platformStatus, {}));
    await core.stop();
    assertEquals(await processesOf(run.home), []);
  } finally {
    await core?.kill().catch(() => {});
    await run.remove();
  }
  for (const status of statuses) {
    assert(status.ready);
    assertEquals(status.data_root, run.home);
  }
  await assertRejects(() => Deno.stat(run.dir), Deno.errors.NotFound);
});
