// 세 질문
// - contract: boundary `server`·`supervision`(user token은 parent pipe hello 한 번으로만 나오고 data root가 격리된다).
// - 현실적 회귀: hello frame 모양이나 권한 flag가 바뀌어 모든 E2E가 못 도는 것, 실행 폴더가 사람의 data root를
//   가리키는 것, 읽기 전용 sdk 사본 때문에 지우기가 실패해 .dev-data가 쌓이는 것.
// - 왜 지금 test로 못 잡나: core를 daemon으로 띄워 token을 받는 test가 없다.
// 아래 둘째 core·끄기·손상 ledger 행(second-core, shutdown-stop, shutdown-kill, damaged-ledger)의 세 질문:
// - contract: boundary `supervision`·`server`(instance lock, child 정리, 시작 실패 알림), `storage`(손상된 ledger를 열지 않고 원본을 지킨다).
// - 현실적 회귀: instance lock이 풀려 두 core가 한 lophn.db를 여는 것, core가 꺼지는데 runtime의 model 요청이 열려 token을 계속 쓰는 것,
//   손상된 ledger를 "고치려고" 덮어쓰는 것.
// - 왜 지금 test로 못 잡나: 위 첫 test는 정상 종료와 SIGKILL 뒤 재기동만 본다. 둘째 instance, 요청이 열린 채 끄기, 손상 ledger는
//   process 둘 이상이나 시작 실패 frame이 필요해 unit이 없다(base에 instance lock test가 없다).
import assert from "node:assert/strict";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { errorCode } from "../../packages/base/mod.ts";
import {
  LOPHN_AGENT_ID,
  receivedMessageList,
  turnList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { platformStatus } from "../../packages/protocol/server/mod.ts";
import {
  connectFakeProvider,
  openWorkspaceSession,
  say,
  waitTurnEnd,
} from "../support/core/human.ts";
import {
  bootCore,
  type Core,
  createRun,
  type Run,
} from "../support/core/mod.ts";
import { processesOf } from "../support/core/process.ts";
import { tryBootCore } from "../support/core/try-boot.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";

test("E2E core는 실행 폴더의 data root만 쓰고, 정리하면 흔적이 남지 않는다", async () => {
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
    assert.deepStrictEqual(await processesOf(run.home), []);
  } finally {
    await core?.kill().catch(() => {});
    await run.remove();
  }
  for (const status of statuses) {
    assert.ok(status.ready);
    assert.deepStrictEqual(status.data_root, run.home);
  }
  await assert.rejects(
    () => stat(run.dir),
    (error: unknown) => errorCode(error) === "ENOENT",
  );
});

const WAIT_MS = 30_000;

// 끄기가 요청을 놓지 않으면 hang 대신 무엇을 기다렸는지 담은 실패로 끝낸다.
async function within<T>(what: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${WAIT_MS}ms 안에 ${what}이(가) 되지 않았다`)),
      WAIT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// run과 fake를 만들고, 띄운 core를 모두 정리한다. boot로 띄운 core만 정리 대상이다.
async function withCore(
  body: (env: {
    run: Run;
    fake: FakeServer;
    boot(): Promise<Core>;
    track(core: Core): void;
  }) => Promise<void>,
): Promise<void> {
  const run = await createRun();
  const fake = await startFakeServer();
  const cores: Core[] = [];
  try {
    await body({
      run,
      fake,
      track: (core) => void cores.push(core),
      boot: async () => {
        const core = await bootCore(run);
        cores.push(core);
        return core;
      },
    });
  } finally {
    for (const core of cores) await core.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
}

// model 요청 하나를 열어 둔 채(stall) 멈춘 core를 돌려준다.
async function bootWithOpenRequest(
  env: Parameters<Parameters<typeof withCore>[0]>[0],
): Promise<Core> {
  env.fake.script([
    {
      reply: { kind: "stall", partial: { text: "half an ans" } },
    },
  ]);
  const core = await env.boot();
  await connectFakeProvider(core, env.fake);
  const session = await openWorkspaceSession(core, LOPHN_AGENT_ID);
  await say(core, session, "hello");
  await within("model 요청이 도착함", env.fake.arrived(1));
  return core;
}

test("같은 data root에 둘째 core는 시작하지 못하고 첫째의 data와 위치 metadata는 그대로다", async () => {
  await withCore(async ({ run, fake, boot, track }) => {
    fake.script([{ reply: { kind: "text", text: "hi" } }]);
    const first = await boot();
    await connectFakeProvider(first, fake);
    const session = await openWorkspaceSession(first, LOPHN_AGENT_ID);
    await say(first, session, "hello");
    await waitTurnEnd(first, session);
    const location = `${run.home}/run/location.json`;
    const processes = await processesOf(run.home);
    const metadata = await readFile(location);
    const messages = (await first.call(receivedMessageList, { session }))
      .messages.length;
    const turns = (await first.call(turnList, { session })).turns.length;

    const second = await tryBootCore(run);
    if (second.ok) track(second.core);

    // process: 둘째는 시작 실패로 끝나고 child를 남기지 않는다.
    assert.ok(!second.ok);
    assert.ok(second.exit !== 0);
    assert.deepStrictEqual(await processesOf(run.home), processes);
    // disk: 위치 metadata는 첫째 것 그대로다.
    assert.deepStrictEqual(await readFile(location), metadata);
    assert.deepStrictEqual(
      JSON.parse(new TextDecoder().decode(metadata)).api_port,
      Number(new URL(first.baseUrl).port),
    );
    // ledger: 첫째가 아직 자기 data를 본다.
    assert.ok((await first.call(platformStatus, {})).ready);
    assert.deepStrictEqual(
      (await first.call(receivedMessageList, { session })).messages.length,
      messages,
    );
    assert.deepStrictEqual(
      (await first.call(turnList, { session })).turns.length,
      turns,
    );
  });
});

test("model 요청이 열린 채 정상 종료하면 child와 요청이 남지 않고 위치 metadata가 지워진다", async () => {
  await withCore(async (env) => {
    const core = await bootWithOpenRequest(env);
    await core.stop();

    // fake: core가 요청을 놓았다.
    await within("요청이 끊김", env.fake.aborted(1));
    assert.deepStrictEqual(env.fake.journal().length, 1);
    // process: stop()이 child까지 없는 것을 확인했다.
    assert.deepStrictEqual(await processesOf(env.run.home), []);
    // disk: 정상 종료에서만 지운다.
    await assert.rejects(
      () => stat(`${env.run.home}/run/location.json`),
      (error: unknown) => errorCode(error) === "ENOENT",
    );
  });
});

test("model 요청이 열린 채 SIGKILL을 맞아도 child가 요청을 놓고 다시 시작한다", async () => {
  await withCore(async (env) => {
    const core = await bootWithOpenRequest(env);
    await core.kill();

    await within("요청이 끊김", env.fake.aborted(1));
    assert.deepStrictEqual(await processesOf(env.run.home), []);
    const again = await env.boot();
    assert.ok((await again.call(platformStatus, {})).ready);
  });
});

test("손상된 ledger로는 시작을 거절하고 원본을 그대로 둔다", async () => {
  await withCore(async ({ run, boot }) => {
    const core = await boot();
    await core.stop();
    const ledger = `${run.home}/lophn.db`;
    await writeFile(ledger, new TextEncoder().encode("garbage ".repeat(500)));
    for (const sidecar of ["-wal", "-shm"]) {
      await rm(ledger + sidecar).catch(() => {});
    }
    const sha256 = async () =>
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new Uint8Array(await readFile(ledger)),
        ),
      );
    const before = await sha256();
    const names = async () => {
      const found: string[] = [];
      for (const entry of await readdir(run.home, { withFileTypes: true })) {
        found.push(entry.name);
      }
      return found.filter((name) => name.endsWith(".db")).sort();
    };
    const dbs = await names();

    const second = await tryBootCore(run);

    // frame
    assert.ok(!second.ok);
    assert.deepStrictEqual(second.reason, "damaged_original");
    assert.ok(second.exit !== 0);
    // disk
    assert.deepStrictEqual(await sha256(), before);
    assert.deepStrictEqual(await names(), dbs);
    // process
    assert.deepStrictEqual(await processesOf(run.home), []);
  });
});
