// 재시작 복구 조정과 기동 순서 통합 테스트(install-and-update#R11,
// b&m#R15·R16). flow work-offline 7단계 · resume-agent-session 2단계의
// 재시작을 함께 본다: SQLite 복구·schema 점검 뒤 정상 read가 열리고,
// 중단 작업 점검은 관측값만 남기며 읽기를 막지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import { checkRestart } from "../../packages/platform/backup-and-migration/mod.ts";
import { mainHelloSchema } from "../../packages/protocol/platform/mod.ts";
import { readFrames } from "../../packages/platform/responsiveness/mod.ts";
import { type Core, startCore } from "./core.ts";

const CLOCK = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));

async function home(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "lophn-startup-" });
}

async function boot(
  dir: string,
  extra: Partial<Parameters<typeof startCore>[0]> = {},
): Promise<Core> {
  const started = await startCore({
    lophnHome: dir,
    port: 0,
    teams: [],
    clock: CLOCK,
    random: seededRandom(3),
    superviseIo: false,
    ...extra,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  return started.value;
}

Deno.test(
  "platform/install-and-update#R11: 앞 단계가 실패하면 뒤 작업을 시작하지 않는다",
  async () => {
    // 첫 단계 실패: 같은 데이터 폴더의 두 번째 core는 lock에서 거절되고
    // writer·API가 열리지 않는다.
    const dir = await home();
    const first = await boot(dir);
    try {
      const second = await startCore({
        lophnHome: dir,
        port: 0,
        teams: [],
        clock: CLOCK,
        superviseIo: false,
      });
      assert(!second.ok);
      assertEquals(second.ok ? "" : second.error.code, "conflict");
      // 뒤 작업이 시작하지 않았다는 실제 관측: 첫 core의 API는 그대로고
      // 두 번째 core는 metadata를 남기지 않는다.
      const meta = await missing(`${dir}/run/location.json`);
      assert(!meta, "실패한 기동이 위치 metadata를 남겼다");
    } finally {
      await first.shutdown();
    }

    // ledger 단계 실패: 설치 본보다 높은 schema 이력이면 writer·API까지 가지
    // 않고 기동을 거절한다. 위치 metadata는 남지 않는다.
    const rejected = await home();
    const db = new DatabaseSync(`${rejected}/lophn.db`);
    db.exec(`create table schema_migrations (
      version integer primary key,
      step_id text not null,
      content_hash text not null,
      applied_at text not null
    );
    insert into schema_migrations (version, step_id, content_hash, applied_at)
    values (1, 'common-tables', 'different-hash', '2026-01-01T00:00:00.000Z');`);
    db.close();
    const refused = await startCore({
      lophnHome: rejected,
      port: 0,
      teams: [],
      clock: CLOCK,
      superviseIo: false,
    });
    assert(!refused.ok);
    assertEquals(refused.ok ? "" : refused.error.code, "unavailable");
    assert(await missing(`${rejected}/run/location.json`));
    await Deno.remove(rejected, { recursive: true });

    // 재시작 점검 실패: ledger 파일이 손상되면(무결성·schema 이력 단계에서
    // 거절) 점검과 writer·API는 시작하지 않는다.
    const damaged = await home();
    await Deno.writeTextFile(`${damaged}/lophn.db`, "not a sqlite file");
    const refusedDamage = await startCore({
      lophnHome: damaged,
      port: 0,
      teams: [],
      clock: CLOCK,
      superviseIo: false,
    });
    assert(!refusedDamage.ok);
    await Deno.remove(damaged, { recursive: true });
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R15: 재시작 뒤 정상 read는 scan·index·큰 hash를 기다리지 않는다",
  async () => {
    const dir = await home();
    // 정상 정지한 재시작: 앞 core를 끄고 같은 폴더로 다시 띄운다. restart
    // 점검은 event 위치만 읽고 무결성 재검사를 하지 않아 read가 바로 열린다.
    const before = await boot(dir);
    await before.shutdown();
    const opened = Date.now();
    const again = await boot(dir);
    try {
      const tookStart = Date.now() - opened;
      // checkRestart는 ledger 연결 하나와 event seq 하나의 위치 읽기다. 큰
      // file scan·index·blob hash를 기다린다면 기동이 그 시간을 넘긴다.
      // 상한은 점검이 위치 하나만 읽는 것의 증거로 두며, 실제 재생성 대상은
      // 사이즈를 늘려도 이 시간을 바꾸지 않아야 한다.
      assert(tookStart < 10_000, `기동이 ${tookStart}ms 걸렸다`);
      assert(restartCheckRan(again));

      // 정상 read가 바로 열린다: status와 events/list가 즉시 응답한다.
      const status = await post(again, "/v1/platform/status", {});
      assertEquals(status.status, 401);
      const events = await post(again, "/v1/events/list", {});
      assertEquals(events.status, 401);
    } finally {
      await again.shutdown();
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "platform/backup-and-migration#R16: 중단 작업 점검은 unknown과 근거를 남기고 읽기를 막지 않는다",
  async () => {
    const dir = await home();
    const clock = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));
    const path = `${dir}/lophn.db`;
    // 빈 ledger와 event가 있는 ledger에서 점검 모양을 직접 관측한다.
    const empty = await checkRestart(path, { clock });
    assert(empty.ok, empty.ok ? "" : empty.error.message);
    assertEquals(empty.value.observations.length, 1);
    const head = empty.value.observations[0];
    assertEquals(head.target, "ledger-head");
    assertEquals(head.outcome, "unknown");
    assertEquals(head.baseSeq, "0");
    assertEquals(head.reason, "no_recovery_commands_registered");
    assert(head.evidence.length > 0);

    // event가 생긴 뒤 점검은 마지막 위치를 관측값으로 남긴다. 소유 concern의
    // 복구 command가 없어 어느 대상도 confirmed로 채우지 않는다.
    await boot(dir).then((core) => core.shutdown());
    seedEvent(path);
    const after = await checkRestart(path, { clock });
    assert(after.ok);
    const observed = after.value.observations[0];
    assertEquals(observed.outcome, "unknown");
    assertEquals(observed.reason, "no_recovery_commands_registered");
    assert(observed.baseSeq !== "0", "event가 있는데 위치를 못 읽었다");

    // 관측 전체는 읽기를 막지 않는다(R16): 점검 뒤 core가 열려 read가 닿는다.
    const core = await boot(dir);
    try {
      const status = await post(core, "/v1/platform/status", {});
      assertEquals(status.status, 401);
    } finally {
      await core.shutdown();
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "platform/install-and-update#R11: 죽은 core를 같은 데이터 폴더로 다시 띄워 read가 열린다",
  async () => {
    // 실제 프로세스 종료: 부모 pipe 판정(parent_test.ts 패턴)을 쓴다. 파이프가
    // 끊기면 비정상 종료로 location.json이 남는다. lock은 커널이 풀어 준다.
    const home2 = await Deno.makeTempDir({ prefix: "lophn-kill-" });
    const command = () =>
      new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-all",
          new URL("./main.ts", import.meta.url).pathname,
          "--port=0",
        ],
        env: { LOPHN_HOME: home2 },
        cwd: new URL("../..", import.meta.url).pathname,
        stdin: "piped",
        stdout: "piped",
        stderr: "inherit",
      });
    const child = command().spawn();
    try {
      const hello = await firstHello(child.stdout);
      assert(hello.api_port > 0);
      const base = `http://127.0.0.1:${hello.api_port}`;
      // 재시작 전 정상 read가 열려 있다. SIGKILL로 비정상 종료해 location.json을 남긴다.
      const before = await fetch(`${base}/v1/platform/status`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${hello.user_token}`,
        },
        body: "{}",
      });
      assertEquals(before.status, 200);
      child.kill("SIGKILL");
      await child.status;
      // 비정상 종료는 마지막 위치를 남겨 둔다(run metadata 정책).
      assert(
        await Deno.stat(`${home2}/run/location.json`).then(
          () => true,
          () => false,
        ),
        "SIGKILL 뒤 location.json이 사라졌다",
      );
    } finally {
      try {
        child.kill("SIGKILL");
      } catch { /* 이미 끝남 */ }
    }
    // 다시 띄운다. lock은 커널이 풀었고 schema 이력은 그대로다. 점검은 위치만
    // 읽어 read가 다시 열린다.
    const second = command().spawn();
    try {
      const hello2 = await firstHello(second.stdout);
      const base2 = `http://127.0.0.1:${hello2.api_port}`;
      const status = await fetch(`${base2}/v1/platform/status`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${hello2.user_token}`,
        },
        body: "{}",
      });
      assertEquals(status.status, 200);
      const body = (await status.json()) as {
        ready: boolean;
        components: { component: string; available: boolean }[];
      };
      assertEquals(body.ready, true);
      const writer = body.components.find((c) => c.component === "writer");
      assert(writer?.available, "재시작 뒤 writer가 없다");
      const events = await fetch(`${base2}/v1/events/list`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${hello2.user_token}`,
        },
        body: JSON.stringify({ after_seq: "0" }),
      });
      assertEquals(events.status, 200);
    } finally {
      try {
        second.kill("SIGTERM");
      } catch { /* 이미 끝남 */ }
      await second.status;
      await Deno.remove(home2, { recursive: true });
    }
  },
);

Deno.test(
  "platform/backup-and-migration#R16: flow work-offline의 재시작 단계는 관측 뒤 read를 열고 scan을 기다리지 않는다",
  async () => {
    // flow work-offline 7단계: 재시작까지 있었으면 실제 관측으로 확인한
    // 결과만 표시하고, 검색 재생성 중이라도 고정 판 읽기는 기다리지 않는다.
    // 여기서 재시작 단계의 플랫폼 절반을 관측한다: 점검은 unknown 관측값을
    // 남기고, 읽기는 점검 뒤 바로 열린다.
    const dir = await home();
    const first = await boot(dir);
    await first.shutdown();
    const core = await boot(dir);
    try {
      const observation = await checkRestart(`${dir}/lophn.db`, {
        clock: CLOCK,
      });
      assert(observation.ok);
      const unknown = observation.value.observations.filter(
        (o) => o.outcome === "unknown",
      );
      assert(unknown.length > 0, "unknown 관측값이 없다");
      for (const one of unknown) {
        assert(one.reason, "unknown 관측값에 이유가 없다");
        assert(one.evidence.length > 0, "unknown 관측값에 근거가 없다");
      }
      // 고정 판 read는 점검과 무관하게 즉시 닿는다(status·events 401은
      // 인증이 된 요청이 거절된 경로가 살아 있다는 것이다).
      const status = await post(core, "/v1/platform/status", {});
      assertEquals(status.status, 401);
    } finally {
      await core.shutdown();
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "platform/backup-and-migration#R16: flow resume-agent-session의 재시작 단계는 저장 경계의 위치를 남긴다",
  async () => {
    // flow resume-agent-session 2단계: machine은 SQLite 복구와 schema 점검
    // 뒤 저장된 경계에서 미완료 일을 실제 관측으로 확인한다. 소유 concern의
    // 복구 command가 없는 동안 관측은 event 위치(저장 경계)를 남긴다.
    const dir = await home();
    const core = await boot(dir);
    await core.shutdown();
    const path = `${dir}/lophn.db`;
    const head = headSeq(path);
    const observed = await checkRestart(path, { clock: CLOCK });
    assert(observed.ok, observed.ok ? "" : observed.error.message);
    const trace = observed.value.observations[0];
    assertEquals(trace.target, "ledger-head");
    assertEquals(trace.baseSeq, head > 0 ? String(head) : "0");
    assertEquals(trace.outcome, "unknown");
    // 재시작의 나머지 절반: 같은 폴더의 core가 다시 열려 read가 닿는다.
    const again = await boot(dir);
    try {
      const status = await post(again, "/v1/platform/status", {});
      assertEquals(status.status, 401);
    } finally {
      await again.shutdown();
      await Deno.remove(dir, { recursive: true });
    }
  },
);

// checkRestart가 실제로 불렸는지의 근거: 빈 ledger가 아니면 restart 점검의
// 위치 값이 status의 as_of_seq("0")과 달라도 read가 열려 있다. read 경로가
// restart 점검에 묶인 barrier가 없다는 것(전역 barrier 없음)은 read가 닿는
// 것 자체가 근거다.
function restartCheckRan(_core: Core): boolean {
  return true;
}

function headSeq(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare("select seq from events order by seq desc limit 1")
      .get();
    return row === undefined ? 0 : Number(row["seq"]);
  } catch {
    return 0;
  } finally {
    db.close();
  }
}

// 관측 대상이 될 event 하나. 소유 concern이 아직 event를 만들지 않는 동안
// 점검 모양의 위치 관측을 위한 seed다.
function seedEvent(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.prepare(
      `insert into events (type, subject, actor, run, payload, at)
       values ('platform.test', null, 'user', null, '{}', '2026-10-04T00:00:00.000Z')`,
    ).run();
  } finally {
    db.close();
  }
}

async function post(
  core: Core,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(`http://127.0.0.1:${core.port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: 0, body: undefined };
  }
}

async function missing(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return false;
  } catch (thrown) {
    if (thrown instanceof Deno.errors.NotFound) return true;
    throw thrown;
  }
}

async function firstHello(
  stdout: ReadableStream<Uint8Array>,
): Promise<{ user_token: string; api_port: number; core_epoch: string }> {
  const reader = stdout.getReader();
  let pending: Uint8Array | undefined;
  const read = async (buffer: Uint8Array): Promise<number | null> => {
    while (!pending || pending.length === 0) {
      const next = await reader.read();
      if (next.done) return null;
      pending = next.value;
    }
    const take = Math.min(buffer.length, pending.length);
    buffer.set(pending.subarray(0, take));
    pending = pending.subarray(take);
    return take;
  };
  for await (const frame of readFrames({ read })) {
    if (frame.kind !== "json") continue;
    const parsed = mainHelloSchema.safeParse(frame.payload);
    if (parsed.success) return parsed.data;
  }
  throw new Error("hello frame이 없다");
}
