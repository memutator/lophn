// 시험이 남긴 앱 자식 정리(testing/app-process.ts의 reapAppProcesses). 실제 프로세스를 띄워 본다.
// 사람 데이터 root는 열지 않는다. 띄운 프로세스는 이 파일이 만든 임시 폴더만 읽는다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  appProcessesReading,
  reapAppProcesses,
} from "./testing/app-process.ts";

async function alive(pid: number): Promise<boolean> {
  try {
    await Deno.stat(`/proc/${pid}`);
    return true;
  } catch {
    return false;
  }
}

// 앱 자식과 같은 모양(`--allow-read=<dir>,<dir>/data`)으로 뜨는 프로세스. 자기 session을 가진다.
function spawnOrphan(dir: string) {
  return new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      `--allow-read=${dir},${dir}/data`,
      "setInterval(() => {}, 1000)",
    ],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
}

Deno.test("apps/runtime#R17: reapAppProcesses는 그 폴더를 읽는 남은 앱 자식을 pid로 찾아 끝내고 다른 프로세스는 건드리지 않는다", async () => {
  const mine = await Deno.makeTempDir({ prefix: "lop-reap-" });
  const other = await Deno.makeTempDir({ prefix: "lop-reap-" });
  const orphan = spawnOrphan(mine);
  const bystander = spawnOrphan(other);
  try {
    // 프로세스가 뜨고 argv가 보일 때까지 기다린다.
    const deadline = performance.now() + 20_000;
    while (
      performance.now() < deadline &&
      ((await appProcessesReading(mine)).length === 0 ||
        (await appProcessesReading(other)).length === 0)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assertEquals(await appProcessesReading(mine), [orphan.pid]);
    assertEquals(await appProcessesReading(other), [bystander.pid]);
    const reaped = await reapAppProcesses(mine);
    assertEquals(reaped, [orphan.pid]);
    // 이 test가 부모라 종료를 거둬야 /proc에서 사라진다.
    const status = await orphan.status;
    assertEquals(status.signal, "SIGKILL");
    assertEquals(await alive(orphan.pid), false);
    assertEquals(await appProcessesReading(mine), []);
    // 다른 폴더의 프로세스는 그대로 산다.
    assert(await alive(bystander.pid));
    assertNotEquals(reaped.includes(bystander.pid), true);
    // 남은 것이 없으면 아무것도 끝내지 않는다.
    assertEquals(await reapAppProcesses(mine), []);
  } finally {
    for (const child of [orphan, bystander]) {
      try {
        child.kill("SIGKILL");
      } catch { /* 이미 끝났다 */ }
      await child.status;
    }
    await Deno.remove(mine, { recursive: true });
    await Deno.remove(other, { recursive: true });
  }
});
