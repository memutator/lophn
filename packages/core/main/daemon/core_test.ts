import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { manualClock, seededRandom } from "../../../base/mod.ts";
import {
  defineRead,
  encodeFrame,
  FrameDecoder,
} from "../../../protocol/base/mod.ts";
import { codingAgentConnectionDefinitions } from "../../server/identity/coding-connection.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration } from "../../projects/register.ts";
import { ticketDefinitions } from "../../apps/tickets/register.ts";

const CLOCK = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));

async function home(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "lophn-core-" });
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

async function mode(path: string): Promise<number> {
  return (await Deno.lstat(path)).mode! & 0o777;
}

Deno.test("platform/install-and-update#R7: LOPHN_HOME 없으면 ~/.lophn, 있으면 그 경로 하나로 고정한다", async () => {
  const base = await Deno.makeTempDir({ prefix: "lophn-home-" });
  const specified = `${base}/explicit`;
  const core = await boot(specified);
  try {
    assertEquals(core.dataRoot, await Deno.realPath(specified));
    const ledger = await Deno.stat(`${core.dataRoot}/lophn.db`);
    assert(ledger.isFile);
    const elsewhere = await Deno.makeTempDir({ prefix: "lophn-other-" });
    try {
      assert(!core.dataRoot.startsWith(elsewhere));
    } finally {
      await Deno.remove(elsewhere, { recursive: true });
    }
  } finally {
    await core.shutdown();
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("platform/install-and-update#R9: root·apps·run이 0700보다 넓거나 symlink면 기동을 거절한다", async () => {
  const wide = await Deno.makeTempDir({ prefix: "lophn-wide-" });
  await Deno.chmod(wide, 0o755);
  const widened = await startCore({
    lophnHome: wide,
    port: 0,
    teams: [],
    superviseIo: false,
  });
  assert(!widened.ok);
  assertEquals(widened.ok ? "" : widened.error.code, "unavailable");

  const target = await Deno.makeTempDir({ prefix: "lophn-target-" });
  const link = `${wide}-link`;
  await Deno.symlink(target, link);
  const linked = await startCore({
    lophnHome: link,
    port: 0,
    teams: [],
    superviseIo: false,
  });
  assert(!linked.ok);

  const owned = await Deno.makeTempDir({ prefix: "lophn-owned-" });
  const core = await boot(owned);
  try {
    assertEquals(await mode(core.dataRoot), 0o700);
    assertEquals(await mode(`${core.dataRoot}/apps`), 0o700);
    assertEquals(await mode(`${core.dataRoot}/run`), 0o700);
  } finally {
    await core.shutdown();
    await Deno.remove(owned, { recursive: true });
    await Deno.remove(wide, { recursive: true });
    await Deno.remove(target, { recursive: true });
    await Deno.remove(link);
  }
});

Deno.test("platform/install-and-update#R10: 같은 데이터 폴더의 두 번째 core는 writer를 열지 않는다", async () => {
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
    const other = await home();
    const independent = await boot(other);
    try {
      assert(independent.dataRoot !== first.dataRoot);
    } finally {
      await independent.shutdown();
      await Deno.remove(other, { recursive: true });
    }
  } finally {
    await first.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/install-and-update#R12: 창 닫기가 아니라 부모의 명시 종료나 pipe EOF가 core를 끝낸다", async () => {
  const dir = await home();
  const parentIn = new TransformStream<Uint8Array, Uint8Array>();
  const parentOut = new TransformStream<Uint8Array, Uint8Array>();
  const core = await boot(dir, {
    parent: {
      stdin: parentIn.readable,
      stdout: parentOut.writable,
    },
  });
  const frames = readParent(parentOut.readable);
  const hello = await frames.next();
  assertEquals(hello.value.core_epoch, core.epoch);
  assertEquals(hello.value.api_port, core.port);
  assertEquals(typeof hello.value.user_token, "string");

  const writer = parentIn.writable.getWriter();
  await writer.write(encodeFrame({
    kind: "json",
    channel: 0,
    payload: { type: "stop", grace_ms: 1000 },
  }));
  await writer.close();
  await core.done;
  assert(await missing(`${dir}/run/location.json`));
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/diagnostics#R8: status와 health는 인증을 요구하고 인증 뒤에 관측 시각을 준다", async () => {
  const dir = await home();
  const parentIn = new TransformStream<Uint8Array, Uint8Array>();
  const parentOut = new TransformStream<Uint8Array, Uint8Array>();
  const core = await boot(dir, {
    parent: { stdin: parentIn.readable, stdout: parentOut.writable },
  });
  try {
    const frames = readParent(parentOut.readable);
    const hello = await frames.next();
    const anonymous = await post(core, "/v1/platform/status", {});
    assertEquals(anonymous.status, 401);
    const health = await post(core, "/v1/platform/health", {});
    assertEquals(health.status, 401);
    assert(!JSON.stringify(anonymous.body).includes(core.dataRoot));

    const authed = await post(
      core,
      "/v1/platform/status",
      {},
      hello.value.user_token,
    );
    assertEquals(authed.status, 200);
    const body = authed.body as {
      ready: boolean;
      schema: number;
      data_root: string;
      ledger_id: string;
      components: { component: string; observed_at: string }[];
    };
    assertEquals(body.ready, true);
    assert(body.schema > 0);
    assertEquals(body.data_root, core.dataRoot);
    assert(body.ledger_id.length > 0);
    assert(body.components.length > 0);
    assertEquals(body.components[0].observed_at, "2026-10-04T00:00:00.000Z");

    const checked = await post(
      core,
      "/v1/platform/health",
      {},
      hello.value.user_token,
    );
    assertEquals(checked.status, 200);
    const observation = checked.body as { observed_at: string };
    assertEquals(observation.observed_at, "2026-10-04T00:00:00.000Z");
    await frames.return();
  } finally {
    await core.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("documents/projects#R8: 사람 user token은 등록 프로젝트의 폴더를 read 목록으로 본다", async () => {
  const dir = await home();
  const core = await boot(dir, {
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("../../projects/register.ts", import.meta.url).href],
    testCredentials: true,
  });
  try {
    const token = "b".repeat(43);
    const context = {
      principal: "user",
      actor: "user" as const,
      credential_ref: "cred_q12person",
      scope: { operations: ["project.create", "project.list"], targets: {} },
      conditions: {},
    };
    assert(core.acceptTestCredential);
    const accepted = await core.acceptTestCredential(context, token);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(context);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);

    // 사람이 프로젝트를 만든다. 폴더는 OS 폴더 선택기로 고른 결과이다.
    const created = await post(core, "/v1/projects/create", {
      input: {
        id: "prj_01kq12a1pha000000000000000",
        name: "alpha",
        title: "Alpha",
        purpose: "",
        folders: [{ path: `${dir}/alpha-folder`, description: "a" }],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      },
      idempotency_key: "create-alpha",
      compare: {},
      prepared: [],
    }, token);
    assertEquals(created.status, 200, JSON.stringify(created.body));

    // 등록 폴더 read. shell main의 `read projects list`와 같은 요청이다.
    const listed = await post(core, "/v1/projects/list", {
      status: "active",
    }, token);
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    const projects = (listed.body as { projects?: unknown[] }).projects ?? [];
    assertEquals(projects.length, 1);
    const first = projects[0] as {
      id?: string;
      folders?: { path: string; description: string }[];
    };
    assertEquals(first.id, "prj_01kq12a1pha000000000000000");
    assertEquals(
      first.folders?.map((folder) => folder.path),
      [`${dir}/alpha-folder`],
    );
    assertEquals(first.folders?.[0].description, "a");
  } finally {
    await core.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/api#R2: 팀 등록 route는 HTTP로 닿고 등록하지 않은 경로는 not_found다", async () => {
  const dir = await home();
  const parentIn = new TransformStream<Uint8Array, Uint8Array>();
  const parentOut = new TransformStream<Uint8Array, Uint8Array>();
  const core = await boot(dir, {
    teams: [{ codingAgentConnectionDefinitions }],
    teamModules: [
      new URL("../../server/identity/coding-connection.ts", import.meta.url)
        .href,
    ],
    parent: { stdin: parentIn.readable, stdout: parentOut.writable },
  });
  try {
    const frames = readParent(parentOut.readable);
    const hello = await frames.next();
    const listed = await post(
      core,
      "/v1/coding_agent_connections/list",
      {},
      hello.value.user_token,
    );
    assertEquals(listed.status, 200);
    assert(
      Array.isArray(
        (listed.body as { connections?: unknown }).connections,
      ),
    );

    const missing = await post(
      core,
      "/v1/coding_agent_connections/unknown",
      {},
      hello.value.user_token,
    );
    assertEquals(missing.status, 404);
    assertEquals(
      (missing.body as { error?: { code?: string } }).error?.code,
      "not_found",
    );
    await frames.return();
  } finally {
    await core.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("coding-agent/tickets#R11: core 기동은 ticket schema와 create·claim route를 등록한다", async () => {
  const dir = await home();
  const parentIn = new TransformStream<Uint8Array, Uint8Array>();
  const parentOut = new TransformStream<Uint8Array, Uint8Array>();
  const core = await boot(dir, {
    teams: [{ ticketDefinitions }],
    teamModules: [
      new URL("../../apps/tickets/register.ts", import.meta.url).href,
    ],
    parent: { stdin: parentIn.readable, stdout: parentOut.writable },
  });
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(`${core.dataRoot}/lophn.db`, {
      readOnly: true,
    });
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tickets'",
    ).all() as { name: string }[];
    db.close();
    assertEquals(tables.map((row) => row.name), ["tickets"]);

    const frames = readParent(parentOut.readable);
    const hello = await frames.next();
    const token = hello.value.user_token;
    const listed = await post(core, "/v1/tickets/list", {}, token);
    assertEquals(listed.status, 200);
    const created = await post(core, "/v1/tickets/create", {}, token);
    assertEquals(created.status !== 404, true);
    const claimed = await post(core, "/v1/tickets/claim", {}, token);
    assertEquals(claimed.status !== 404, true);
    const missing = await post(core, "/v1/tickets/unknown", {}, token);
    assertEquals(missing.status, 404);
    await frames.return();
  } finally {
    await core.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/identity#R4: parent.ts가 내는 사람 token은 user route를 모두 쓰고 machine 전용은 거절된다", async () => {
  const dir = await home();
  const parentIn = new TransformStream<Uint8Array, Uint8Array>();
  const parentOut = new TransformStream<Uint8Array, Uint8Array>();
  const core = await boot(dir, {
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("../../projects/register.ts", import.meta.url).href],
    parent: { stdin: parentIn.readable, stdout: parentOut.writable },
  });
  try {
    const frames = readParent(parentOut.readable);
    const hello = await frames.next();
    const token = hello.value.user_token;

    // 프로젝트 만들기와 목록은 user를 허용하는 route라 token scope에 들어 있다.
    const created = await post(core, "/v1/projects/create", {
      input: {
        id: "prj_01kq12a1pha000000000000000",
        name: "alpha",
        title: "Alpha",
        purpose: "",
        folders: [{ path: `${dir}/identity-folder`, description: "a" }],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      },
      idempotency_key: "identity-r4-create",
      compare: {},
      prepared: [],
    }, token);
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const listed = await post(core, "/v1/projects/list", {}, token);
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    assertEquals(
      ((listed.body as { projects?: unknown[] }).projects ?? []).length,
      1,
    );

    // machine 전용 command는 route actor 상한 때문에 token에 없고 거절된다.
    const machineOnly = await post(core, "/v1/events/advance-cursor", {
      input: { subscriber: "parent", scanned_through_seq: "0" },
      idempotency_key: "identity-r4-machine",
      compare: { processed_through_seq: "0" },
      prepared: [],
    }, token);
    assertEquals(machineOnly.status, 403, JSON.stringify(machineOnly.body));

    // 제품 사람 token으로 settings read가 된다(core가 settings를 서빙한다).
    const settings = await post(core, "/v1/settings/get", {
      keys: ["shell.reading_width"],
    }, token);
    assertEquals(settings.status, 200, JSON.stringify(settings.body));
    await frames.return();
  } finally {
    await core.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/api#R2: platform 기본 route와 같은 경로를 팀이 등록하면 core는 기동하지 않는다", async () => {
  const dir = await home();
  const duplicate = defineRead({
    resource: "platform",
    method: "status",
    name: "DuplicateStatus",
    input: z.object({}),
    output: z.object({}),
    actors: ["user"],
    errors: ["not_found"],
  });
  const started = await startCore({
    lophnHome: dir,
    port: 0,
    teams: [{
      createCoreRegistration: () => ({
        reads: [{
          route: duplicate,
          handle: () => ({ ok: true as const, value: {} }),
        }],
      }),
    }],
    clock: CLOCK,
    superviseIo: false,
  });
  assert(!started.ok);
  assertEquals(started.ok ? "" : started.error.code, "internal");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R21: 종료는 새 입장을 닫고 위치 metadata를 지운 뒤 lock을 푼다", async () => {
  const dir = await home();
  const core = await boot(dir);
  const meta = JSON.parse(await Deno.readTextFile(`${dir}/run/location.json`));
  assertEquals(meta.api_port, core.port);
  assertEquals(meta.core_epoch, core.epoch);
  assertEquals(meta.format, 1);
  assert(!("token" in meta) && !("credential" in meta));

  await core.shutdown();
  assert(await missing(`${dir}/run/location.json`));
  const during = await post(core, "/v1/platform/status", {});
  assert(during.status === 0 || during.status >= 400);

  const again = await boot(dir);
  try {
    assertEquals(again.dataRoot, core.dataRoot);
  } finally {
    await again.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});

async function post(
  core: Core,
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(`http://127.0.0.1:${core.port}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: 0, body: undefined };
  }
}

function readParent(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new FrameDecoder();
  const pending: {
    user_token: string;
    api_port: number;
    core_epoch: string;
  }[] = [];
  return {
    async next(): Promise<
      { value: { user_token: string; api_port: number; core_epoch: string } }
    > {
      while (pending.length === 0) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("parent closed before hello");
        for (const frame of decoder.push(chunk.value)) {
          if (frame.kind === "json") pending.push(frame.payload as never);
        }
      }
      return { value: pending.shift()! };
    },
    async return() {
      await reader.cancel();
    },
    get done() {
      return reader.closed;
    },
  };
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
