// preview를 실제 core(임시 LOPHN_HOME)·실제 apps supervisor·실제 앱 자식 프로세스로 본다. 사람
// 데이터 root는 열지 않는다. 앱 bundle은 temp 폴더의 fixture이고 core에는 그 bundle을 여는 자리만
// 끼운다(release 준비·activation 조립이 낼 자리의 대역).
import { assert, assertEquals } from "@std/assert";
import { ok } from "../../packages/base/mod.ts";
import { appFlags } from "../../packages/apps/permissions/mod.ts";
import {
  COMMANDS,
  openWorld,
  SCREENS,
  type World,
} from "../../packages/apps/runtime/world_test.ts";
import { writeFixtureBundle } from "../../packages/apps/runtime/testing/mod.ts";
import type { PreviewBundles } from "../../packages/apps/preview/mod.ts";
import { call, count, inspect } from "./testing/approvals-fixture.ts";

async function until<T>(
  what: string,
  read: () => Promise<T | undefined>,
  ms = 30_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

type Opened = { world: World; dir: string; bundleHash: string; token: string };

async function withPreviews(
  run: (opened: Opened) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "lop-pvb-" });
  const bundle = await writeFixtureBundle(dir);
  let port = 0;
  const bundles: PreviewBundles = {
    open(_app, hash) {
      if (hash !== bundle.bundleHash) return Promise.resolve(ok(undefined));
      return Promise.resolve(ok({
        entry: bundle.entry,
        importMap: bundle.importMap,
        commands: [...COMMANDS],
        screens: { usage: [...SCREENS.usage], overview: [...SCREENS.overview] },
        dataSchema: 0,
        fixture: () => Promise.resolve(undefined),
        flags(dataPath: string) {
          return appFlags(
            [],
            { bundle: dir, data: dataPath },
            { ports: [port] },
            [],
          );
        },
      }));
    },
  };
  const world = await openWorld({
    supervisor: true,
    sweepMs: 200,
    previews: { bundles },
  });
  port = world.harness.port;
  const token = (await world.login("user", [
    "app.connect",
    "app.runtime",
    "previews.start",
    "previews.get",
    "previews.stop",
  ])).token;
  try {
    await run({ world, dir, bundleHash: bundle.bundleHash, token });
  } finally {
    await world.close();
    await Deno.remove(dir, { recursive: true }).catch(() => undefined);
  }
}

function startBody(opened: Opened, overrides: Record<string, unknown> = {}) {
  return {
    input: {
      app: opened.world.app,
      bundle_hash: opened.bundleHash,
      release: null,
      fixture_hash: null,
      ...overrides,
    },
  };
}

type Seen = {
  observation: {
    app: string;
    release: string | null;
    mode: string;
    process_nonce: string;
    endpoint: string | null;
    ready: boolean;
    accepting: boolean;
  } | null;
  observed_at: string | null;
};

async function readyPreview(opened: Opened, nonce: string): Promise<Seen> {
  return await until("the preview to be ready", async () => {
    const seen = await call(
      opened.world.harness,
      "previews/get",
      opened.token,
      {
        app: opened.world.app,
        process_nonce: nonce,
      },
    );
    assertEquals(seen.status, 200, JSON.stringify(seen.body));
    const body = seen.body as unknown as Seen;
    return body.observation?.ready ? body : undefined;
  });
}

function facts(opened: Opened) {
  const { harness, app } = opened.world;
  return {
    app: inspect(
      harness,
      "SELECT active_release, run_enabled, revision, status FROM apps WHERE id = ?",
      [app],
    ),
    events: count(harness, "SELECT COUNT(*) AS n FROM events"),
    grants: count(harness, "SELECT COUNT(*) AS n FROM grants"),
    invocations: count(harness, "SELECT COUNT(*) AS n FROM invocations"),
  };
}

Deno.test("apps/preview#R1, R2, R3, R7, R10: 실제 core·supervisor로 release 없는 preview를 열고 연결해 호출하고 종료하면 운영 사실과 data는 그대로다", async () => {
  await withPreviews(async (opened) => {
    const { world, token } = opened;
    const before = facts(opened);
    const started = await call(
      world.harness,
      "previews/start",
      token,
      startBody(opened),
    );
    assertEquals(started.status, 200, JSON.stringify(started.body));
    const nonce = String(started.body["process_nonce"]);
    assertEquals(started.body["ready"], false);
    const seen = await readyPreview(opened, nonce);
    const observation = seen.observation!;
    // 관측은 mode=preview이고 release가 없으며 연결 주소를 내지 않는다.
    assertEquals(observation.mode, "preview");
    assertEquals(observation.release, null);
    assertEquals(observation.endpoint, null);
    assertEquals(observation.accepting, false);
    assertEquals(observation.process_nonce, nonce);
    // disposable 영역은 이 nonce 아래에만 있다(운영 data 자리와 따로).
    const area = `${world.harness.dataRoot}/apps/${world.app}/preview/${nonce}`;
    assert((await Deno.stat(area)).isDirectory);
    // 인증된 connect로만 연결하고 preview 자식을 부른다. 운영 mode connect는 값 없음이다.
    const connected = await call(world.harness, "apps/connect", token, {
      app: world.app,
      mode: "preview",
      preview_nonce: nonce,
      screens: ["usage"],
      screen_sizes: {},
      commands: ["usage.read", "usage.save"],
    });
    assertEquals(connected.status, 200, JSON.stringify(connected.body));
    assertEquals(
      (connected.body["connection"] as { mode: string; release: unknown }).mode,
      "preview",
    );
    assertEquals(
      (connected.body["connection"] as { release: unknown }).release,
      null,
    );
    const authorization = JSON.stringify({
      payload: connected.body["connection"],
      signature: connected.body["signature"],
    });
    const invoked = await direct(
      String(connected.body["endpoint"]),
      authorization,
      { request_key: "p1", command: "usage.save" },
    );
    assertEquals(invoked.status, 200, JSON.stringify(invoked.body));
    assertEquals((invoked.body as { mode: string }).mode, "preview");
    assertEquals("invocation" in (invoked.body as object), false);
    const live = await call(world.harness, "apps/connect", token, {
      app: world.app,
      mode: "live",
      screens: ["usage"],
      screen_sizes: {},
      commands: ["usage.read"],
    });
    assertEquals(live.status, 503, JSON.stringify(live.body));
    // preview가 떠 있는 동안 운영 쪽 사실은 읽기만 했다.
    assertEquals(facts(opened), before);
    const stopped = await call(world.harness, "previews/stop", token, {
      app: world.app,
      process_nonce: nonce,
    });
    assertEquals(stopped.status, 200, JSON.stringify(stopped.body));
    assertEquals(stopped.body["stopped"], true);
    // 종료한 preview: 관측 없음, 영역 폐기, 연결 거절, 같은 nonce의 connect는 값 없음.
    const gone = await call(world.harness, "previews/get", token, {
      app: world.app,
      process_nonce: nonce,
    });
    assertEquals(gone.body["observation"], null);
    assertEquals(
      await Deno.stat(area).then(() => true, () => false),
      false,
    );
    const again = await call(world.harness, "apps/connect", token, {
      app: world.app,
      mode: "preview",
      preview_nonce: nonce,
      screens: ["usage"],
      screen_sizes: {},
      commands: ["usage.read"],
    });
    assertEquals(again.status, 503, JSON.stringify(again.body));
    let reachable = true;
    try {
      (await Deno.connect({
        path: String(connected.body["endpoint"]),
        transport: "unix",
      })).close();
    } catch {
      reachable = false;
    }
    assertEquals(reachable, false);
    assertEquals(facts(opened), before);
  });
});

Deno.test("apps/preview#R1: 범위 밖 앱과 없는 앱의 preview 요청은 같은 not_found이고 machine 자격은 쓰지 못한다", async () => {
  await withPreviews(async (opened) => {
    const { world } = opened;
    const outside = (await world.login(
      "user",
      ["previews.start", "previews.get", "previews.stop"],
      { targets: { app: "app_01arz3ndektsv4rrffq69g5faw" } },
    )).token;
    const missing = await call(
      world.harness,
      "previews/start",
      opened.token,
      startBody(opened, { app: "app_01arz3ndektsv4rrffq69g5fax" }),
    );
    const scoped = await call(
      world.harness,
      "previews/start",
      outside,
      startBody(opened),
    );
    assertEquals(missing.status, 404, JSON.stringify(missing.body));
    assertEquals(scoped.status, 404, JSON.stringify(scoped.body));
    assertEquals(scoped.body, missing.body);
    for (const method of ["get", "stop"]) {
      const reply = await call(world.harness, `previews/${method}`, outside, {
        app: world.app,
        process_nonce: "nonce-1234567",
      });
      assertEquals(
        reply.status,
        404,
        `${method}: ${JSON.stringify(reply.body)}`,
      );
    }
    // 준비된 bundle이 아닌 hash는 앱 안에서도 없는 것과 같다.
    const unknownBundle = await call(
      world.harness,
      "previews/start",
      opened.token,
      startBody(opened, { bundle_hash: "cd".repeat(32) }),
    );
    assertEquals(unknownBundle.status, 404);
    const machine = await world.login("machine", ["previews.start"]);
    const refused = await call(
      world.harness,
      "previews/start",
      machine.token,
      startBody(opened),
    );
    assert(
      refused.status === 403 || refused.status === 401,
      String(refused.status),
    );
  });
});

Deno.test("apps/preview#R1: 같은 앱의 새 preview는 이전 preview의 종료를 확인한 뒤 뜨고 이전 nonce는 사라진다", async () => {
  await withPreviews(async (opened) => {
    const { world, token } = opened;
    const first = await call(
      world.harness,
      "previews/start",
      token,
      startBody(opened),
    );
    assertEquals(first.status, 200, JSON.stringify(first.body));
    const firstNonce = String(first.body["process_nonce"]);
    await readyPreview(opened, firstNonce);
    const second = await call(
      world.harness,
      "previews/start",
      token,
      startBody(opened),
    );
    assertEquals(second.status, 200, JSON.stringify(second.body));
    const secondNonce = String(second.body["process_nonce"]);
    assert(secondNonce !== firstNonce);
    await readyPreview(opened, secondNonce);
    const old = await call(world.harness, "previews/get", token, {
      app: world.app,
      process_nonce: firstNonce,
    });
    assertEquals(old.body["observation"], null);
    assertEquals(
      await Deno.stat(
        `${world.harness.dataRoot}/apps/${world.app}/preview/${firstNonce}`,
      ).then(() => true, () => false),
      false,
    );
  });
});

async function direct(
  endpoint: string,
  authorization: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const client = Deno.createHttpClient({
    proxy: { transport: "unix", path: endpoint },
  });
  try {
    const response = await fetch(
      "http://lophn.invalid/_lophn/commands/invoke",
      {
        client,
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  } finally {
    client.close();
  }
}
