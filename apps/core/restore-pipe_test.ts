// platform/backup-and-migration#R13, R14: 제품 진입점(main.ts)을 별도 프로세스로 띄워 main↔core
// 비공개 pipe의 복원 통로를 본다. main은 계획을 읽고(잃을 범위), 사람이 확인한 handle로 복원을
// 청하고, core는 정지·복원 뒤 같은 pipe로 새 hello를 보내며 다시 시작한다. 임시 data root만 쓰고
// 사람 data root는 열지 않는다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  coreToMainMessageSchema,
  encodeFrame,
  type MainHello,
  mainHelloSchema,
} from "../../packages/protocol/platform/mod.ts";
import {
  backupStamp,
  createBackup,
  RESTORE_DECISION,
} from "../../packages/core/storage/migration/mod.ts";
import { readFrames } from "../../packages/core/supervision/responsiveness/mod.ts";

type Json = Record<string, unknown>;

const PROJECTS = [1, 2, 3, 4].map((n) => `prj_01kq12a1pha00000000000000${n}`);
const BACKUP_AT = "2024-01-02T03:04:05.000Z";

// 부모(main) 역할. 실제 main.ts를 띄우고 pipe의 json frame을 차례로 읽는다.
class FakeMain {
  readonly home: string;
  #child: Deno.ChildProcess;
  #writer: WritableStreamDefaultWriter<Uint8Array>;
  #frames: AsyncIterator<unknown>;

  constructor(home: string) {
    this.home = home;
    this.#child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-all",
        new URL("./main.ts", import.meta.url).pathname,
        "--port=0",
      ],
      env: { LOPHN_HOME: home },
      cwd: new URL("../..", import.meta.url).pathname,
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
    }).spawn();
    this.#writer = this.#child.stdin.getWriter();
    const reader = this.#child.stdout.getReader();
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
    const json = async function* () {
      for await (const frame of readFrames({ read })) {
        if (frame.kind === "json") yield frame.payload;
      }
    };
    this.#frames = json();
  }

  async send(payload: unknown): Promise<void> {
    await this.#writer.write(
      encodeFrame({ kind: "json", channel: 0, payload }),
    );
  }

  // 다음 core 메시지. 30초 안에 오지 않으면 실패다.
  async next(): Promise<Json> {
    const timer = AbortSignal.timeout(30_000);
    const frame = await Promise.race([
      this.#frames.next(),
      new Promise<never>((_resolve, reject) =>
        timer.addEventListener(
          "abort",
          () => reject(new Error("core 메시지가 오지 않았다")),
          { once: true },
        )
      ),
    ]);
    assert(!frame.done, "pipe가 닫혔다");
    assert(coreToMainMessageSchema.safeParse(frame.value).success);
    return frame.value as Json;
  }

  async hello(): Promise<MainHello> {
    const parsed = mainHelloSchema.safeParse(await this.next());
    assert(parsed.success, "hello가 아니다");
    return parsed.data;
  }

  async close(): Promise<void> {
    try {
      this.#child.kill("SIGTERM");
    } catch { /* 이미 끝남 */ }
    await this.#child.status;
  }
}

async function post(hello: MainHello, path: string, body: unknown) {
  const response = await fetch(
    `http://127.0.0.1:${hello.api_port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${hello.user_token}`,
      },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: await response.json() as Json };
}

async function createProject(hello: MainHello, id: string, name: string) {
  const created = await post(hello, "projects/create", {
    input: {
      id,
      name,
      title: name,
      purpose: "",
      folders: [],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    },
    idempotency_key: `create-${name}`,
    compare: {},
    prepared: [],
  });
  assertEquals(created.status, 200, JSON.stringify(created.body));
}

async function projectNames(hello: MainHello): Promise<string[]> {
  const listed = await post(hello, "projects/list", { status: "active" });
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  return ((listed.body as { projects?: { name: string }[] }).projects ?? [])
    .map((project) => project.name).sort();
}

async function ledgerId(hello: MainHello): Promise<string> {
  const status = await post(hello, "platform/status", {});
  assertEquals(status.status, 200, JSON.stringify(status.body));
  return String(status.body["ledger_id"]);
}

// 운영 중 ledger에서 backup을 만든다. I/O worker의 하루 backup과 같은 createBackup이다.
async function backupNow(home: string) {
  const stamp = backupStamp(BACKUP_AT);
  assert(stamp.ok);
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  const version = Number(
    (db.prepare("select max(version) as v from schema_migrations").get() as {
      v: number | bigint;
    }).v,
  );
  db.close();
  const created = await createBackup(`${home}/lophn.db`, {
    root: home,
    schemaVersion: version,
    stamp: stamp.value,
    now: () => BACKUP_AT,
  });
  assert(created.ok, created.ok ? "" : created.error.message);
  return created.value;
}

function eventSeqs(path: string): number[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare("select seq from events order by seq").all().map((row) =>
      Number(row["seq"])
    );
  } finally {
    db.close();
  }
}

async function registerHandle(
  main: FakeMain,
  plan: Json,
): Promise<string> {
  await main.send({
    type: "confirmation_handle_register",
    window_id: "win-restore",
    target_ref: plan["target"],
    content_hash: plan["content_hash"],
    allowed_decisions: [RESTORE_DECISION],
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  const registered = await main.next();
  assertEquals(registered["type"], "confirmation_handle_registered");
  return registered["confirmation"] as string;
}

async function reachable(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/platform/health`);
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

Deno.test("platform/backup-and-migration#R13 #R14: main이 pipe로 잃을 범위를 읽고 확인한 handle로 복원을 청하면 core가 새 hello로 다시 시작한다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-restore-pipe-" });
  const main = new FakeMain(home);
  try {
    const first = await main.hello();
    await createProject(first, PROJECTS[0], "alpha");
    await createProject(first, PROJECTS[1], "bravo");
    const backup = await backupNow(home);
    // 제품 기동이 남기는 기록이 있어 seq는 묶음마다 상대로 본다.
    const through = Number(backup.through_seq);
    // backup 뒤에 쓴 기록 둘. 복원하면 잃는다.
    await createProject(first, PROJECTS[2], "charlie");
    await createProject(first, PROJECTS[3], "delta");
    const oldLedgerId = await ledgerId(first);

    // 없는 묶음의 계획은 없다. core는 그대로 서비스 중이다.
    await main.send({
      type: "restore_plan_request",
      created_at: "2020-01-01T00:00:00.000Z",
    });
    const missing = await main.next();
    assertEquals(missing["type"], "restore_failed");
    assertEquals(missing["stage"], "plan");
    assertEquals(missing["code"], "not_found");
    assertEquals(missing["restarted"], false);

    // 사람이 볼 잃을 범위.
    await main.send({
      type: "restore_plan_request",
      created_at: backup.created_at,
    });
    const plan = await main.next();
    assertEquals(plan["type"], "restore_plan");
    assertEquals(plan["through_seq"], String(through));
    assertEquals(plan["current_through_seq"], String(through + 2));
    assertEquals(plan["lost"], {
      from_seq: String(through + 1),
      through_seq: String(through + 2),
      events: 2,
    });

    // 확인이 없으면 아무것도 멈추지 않는다.
    await main.send({
      type: "restore_request",
      created_at: backup.created_at,
      confirmation: "x".repeat(43),
    });
    const refused = await main.next();
    assertEquals(refused["type"], "restore_failed");
    assertEquals(refused["stage"], "restore");
    assertEquals(refused["restarted"], false);
    assertEquals(await projectNames(first), [
      "alpha",
      "bravo",
      "charlie",
      "delta",
    ]);

    // 사람이 범위를 확인해 발급한 handle로 복원한다.
    await main.send({
      type: "restore_request",
      created_at: backup.created_at,
      confirmation: await registerHandle(main, plan),
    });
    const result = await main.next();
    assertEquals(result["type"], "restore_result");
    assertEquals(result["restored_through_seq"], String(through));
    assertEquals(result["previous_through_seq"], String(through + 2));

    // 같은 pipe로 새 core의 hello가 온다. 새 epoch·새 token·새 ledger_id다.
    const second = await main.hello();
    assertNotEquals(second.core_epoch, first.core_epoch);
    assertNotEquals(second.user_token, first.user_token);
    assertNotEquals(await ledgerId(second), oldLedgerId);
    assertEquals(await projectNames(second), ["alpha", "bravo"]);
    // 옛 core는 닫혔고 옛 token은 새 core에서 통하지 않는다.
    if (second.api_port !== first.api_port) {
      assertEquals(await reachable(first.api_port), false);
    }
    const stale = await fetch(
      `http://127.0.0.1:${second.api_port}/v1/platform/status`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${first.user_token}`,
        },
        body: "{}",
      },
    );
    await stale.body?.cancel();
    assertEquals(stale.status, 401);
    // 복원 전 자료(seq 4까지)는 보존본으로 남고 복원본은 seq 2까지다.
    const restoreRoot = `${home}/backups/restore`;
    const kept = (await Array.fromAsync(Deno.readDir(restoreRoot)))
      .map((entry) => `${restoreRoot}/${entry.name}/previous/ledger.db`);
    assertEquals(kept.length, 1);
    assertEquals(eventSeqs(kept[0]).at(-1), through + 2);
    assertEquals(eventSeqs(`${home}/lophn.db`).at(-1), through);

    // 새 core가 같은 pipe에서 다음 계획 요청도 받는다.
    await main.send({
      type: "restore_plan_request",
      created_at: backup.created_at,
    });
    const again = await main.next();
    assertEquals(again["type"], "restore_plan");
  } finally {
    await main.close();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("platform/backup-and-migration#R13: 정지한 뒤 복원이 실패하면 현재 자료 그대로 core가 새 hello로 다시 시작한다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-restore-pipe-bad-" });
  const main = new FakeMain(home);
  try {
    const first = await main.hello();
    await createProject(first, PROJECTS[0], "alpha");
    const backup = await backupNow(home);
    await createProject(first, PROJECTS[1], "bravo");
    const oldLedgerId = await ledgerId(first);
    await main.send({
      type: "restore_plan_request",
      created_at: backup.created_at,
    });
    const plan = await main.next();
    assertEquals(plan["type"], "restore_plan");
    // 확인한 뒤 묶음 ledger가 변조됐다. 정지 뒤 검증이 막는다.
    const folder = (await Array.fromAsync(Deno.readDir(`${home}/backups`)))
      .find((entry) => /^[0-9]{8}T/.test(entry.name))!.name;
    const path = `${home}/backups/${folder}/ledger.db`;
    const bytes = await Deno.readFile(path);
    bytes[bytes.length - 1] ^= 0xff;
    await Deno.writeFile(path, bytes);

    await main.send({
      type: "restore_request",
      created_at: backup.created_at,
      confirmation: await registerHandle(main, plan),
    });
    const failed = await main.next();
    assertEquals(failed["type"], "restore_failed");
    assertEquals(failed["stage"], "restore");
    assertEquals(failed["restarted"], true);
    // 현재 자료와 ledger 식별은 그대로다.
    const second = await main.hello();
    assertNotEquals(second.core_epoch, first.core_epoch);
    assertEquals(await ledgerId(second), oldLedgerId);
    assertEquals(await projectNames(second), ["alpha", "bravo"]);
  } finally {
    await main.close();
    await Deno.remove(home, { recursive: true });
  }
});
