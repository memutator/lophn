// cap-fs·cap-net·cap-store·cap-save·cap-secret이 실제 broker(apps/permissions/broker)에 닿는
// 자리를 한 번에 본다. 단위 동작은 각 package의 *_test.ts가 본다. 외부 network는 쓰지 않고
// 127.0.0.1의 local fake server만 쓴다.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { ok, type Result } from "../../packages/base/mod.ts";
import {
  type BrokerListener,
  createBrokerEndpoint,
  createDocumentSaveService,
  createNetFetchService,
  createSecretUseService,
  type DocumentSaveOutput,
  type DocumentsSave,
  type SecretDelivery,
  type SecretDeliveryRequest,
  serveBroker,
} from "../../packages/core/apps/permissions/mod.ts";
import {
  APP,
  createAccessFixture,
  CREDENTIAL,
  HASH,
  NONCE,
  RELEASE,
  requirement,
  serveLocal,
} from "../../packages/core/apps/permissions/testing/broker.ts";
import {
  CapabilityError as NetError,
  createNetClient,
} from "../../packages/sdk/cap-net/mod.ts";
import {
  CapabilityError as SaveError,
  createSaveClient,
} from "../../packages/sdk/cap-save/mod.ts";
import {
  CapabilityError as SecretError,
  createSecretClient,
} from "../../packages/sdk/cap-secret/mod.ts";
import type { CapHost, RuntimeMode } from "../../packages/sdk/cap-net/mod.ts";
import * as capFs from "../../packages/sdk/cap-fs/mod.ts";
import * as capNet from "../../packages/sdk/cap-net/mod.ts";
import * as capStore from "../../packages/sdk/cap-store/mod.ts";
import * as capSave from "../../packages/sdk/cap-save/mod.ts";
import * as capSecret from "../../packages/sdk/cap-secret/mod.ts";
import * as capProblem from "../../packages/sdk/cap-problem/mod.ts";
import { createProblemReporter } from "../../packages/sdk/cap-problem/mod.ts";

const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";
const SECRET_NAME = "calendar.token";
const SECRET_VALUE = "s3cret-VALUE-9f2a";
const VER = (n: number) => `ver_${String(n).padStart(26, "0")}`;

type Setup = {
  access: ReturnType<typeof createAccessFixture>;
  host(mode?: RuntimeMode): CapHost;
  secretRequests: SecretDeliveryRequest[];
  saves: { key: string; base: string | null; retry: string }[];
  stop(): Promise<void>;
};

// 실제 broker endpoint를 unix socket으로 듣고 앱 쪽 host port가 거기로 POST한다.
async function setup(
  declare: ReturnType<typeof requirement>[],
): Promise<Setup> {
  const access = createAccessFixture({
    permissions: declare,
    commands: ["sync"],
  });
  const secretRequests: SecretDeliveryRequest[] = [];
  const delivery: SecretDelivery = {
    use(request) {
      secretRequests.push(request);
      return Promise.resolve(ok({ sent: true as const }));
    },
  };
  const saves: Setup["saves"] = [];
  const versions = new Map<string, string[]>();
  const retries = new Map<string, string>();
  const documents: DocumentsSave = {
    save(request): Promise<Result<DocumentSaveOutput>> {
      saves.push({
        key: request.key,
        base: request.baseVersion,
        retry: request.idempotencyKey,
      });
      const retry = `${request.key}/${request.idempotencyKey}`;
      const known = retries.get(retry);
      if (known !== undefined) {
        return Promise.resolve(ok({ saved: true, version: known }));
      }
      const kept = versions.get(request.key) ?? [];
      const version = VER(kept.length + 1);
      versions.set(request.key, [...kept, version]);
      retries.set(retry, version);
      return Promise.resolve(ok({ saved: true, version }));
    },
  };
  const child = {
    app: APP,
    release: RELEASE,
    mode: "live" as const,
    processNonce: NONCE,
  };
  const endpoint = createBrokerEndpoint({
    session: { child, credential: CREDENTIAL },
    services: {
      net: createNetFetchService({ access, scheme: "http", platformPorts: [] }),
      secrets: createSecretUseService({
        access,
        delivery,
        redaction: { ensure: () => ok(undefined) },
        platformPorts: [],
      }),
      documents: createDocumentSaveService({ access, documents }),
    },
  });
  const dir = await Deno.makeTempDir({ prefix: "sdk-caps-" });
  const socket = `${dir}/broker.sock`;
  const listener: BrokerListener = serveBroker(socket, endpoint);
  const client = Deno.createHttpClient({
    proxy: { transport: "unix", path: socket },
  });
  return {
    access,
    secretRequests,
    saves,
    host(mode = "live") {
      return {
        mode,
        async post(path, body, options) {
          const response = await fetch(`http://broker${path}`, {
            client,
            method: "POST",
            signal: options?.signal,
            headers: {
              authorization: `Bearer ${CREDENTIAL}`,
              "content-type": "application/json",
            },
            // host가 process_nonce와 mode를 붙인다. 앱 코드와 SDK는 보지 못한다.
            body: JSON.stringify({
              process_nonce: NONCE,
              mode: "live",
              ...body,
            }),
          });
          return { status: response.status, body: await response.json() };
        },
        call: () => ({
          command: "sync",
          inputHash: HASH,
          release: RELEASE,
          invocation: INV,
        }),
      };
    },
    async stop() {
      client.close();
      await listener.shutdown();
      await Deno.remove(dir, { recursive: true });
    },
  };
}

Deno.test("apps/sdk#R22 apps/sdk#R23 apps/sdk#R24: cap-net importing grants nothing, a refusal names net.fetch and the exact destination, and a grant opens only that destination", async () => {
  const target = serveLocal(() => Response.json({ items: [1, 2] }));
  const other = serveLocal(() => Response.json({ other: true }));
  const world = await setup([
    requirement("net.fetch", { host: "127.0.0.1", port: target.port }),
    requirement("net.fetch", { host: "127.0.0.1", port: other.port }),
  ]);
  try {
    const net = createNetClient({ host: world.host() });
    const request = { host: "127.0.0.1", port: target.port, path: "/items" };
    // 선언만 있고 grant가 없으면 import한 client도 나가지 못한다.
    const refused = await assertRejects(() => net.fetch(request), NetError);
    assertEquals(refused.code, "forbidden");
    assertEquals(refused.permission, "net.fetch");
    assertEquals(refused.scope, { host: "127.0.0.1", port: target.port });
    assert(refused.message.includes("net.fetch"));
    assert(refused.message.includes(String(target.port)));
    assertEquals(target.seen.length, 0);

    const grant = world.access.grant({
      kind: "net.fetch",
      host: "127.0.0.1",
      port: target.port,
    });
    assertEquals(await net.fetch(request), {
      status: 200,
      body: { items: [1, 2] },
    });
    assertEquals(target.seen.length, 1);
    // grant는 그 host·port 하나만 연다.
    const elsewhere = await assertRejects(
      () => net.fetch({ ...request, port: other.port }),
      NetError,
    );
    assertEquals(elsewhere.scope, { host: "127.0.0.1", port: other.port });
    assertEquals(other.seen.length, 0);
    // 회수하면 다음 요청부터 거절한다.
    world.access.revoke(grant);
    await assertRejects(() => net.fetch(request), NetError);
    assertEquals(target.seen.length, 1);
  } finally {
    await world.stop();
    await target.stop();
    await other.stop();
  }
});

Deno.test("apps/sdk#R24: cap-net retries a read through the real broker and does not repeat a write", async () => {
  let hits = 0;
  const target = serveLocal(() => {
    hits += 1;
    return hits < 3
      ? new Response("busy", { status: 503 })
      : Response.json({ ok: true });
  });
  const world = await setup([
    requirement("net.fetch", { host: "127.0.0.1", port: target.port }),
  ]);
  try {
    world.access.grant({
      kind: "net.fetch",
      host: "127.0.0.1",
      port: target.port,
    });
    const net = createNetClient({
      host: world.host(),
      sleep: () => Promise.resolve(),
    });
    const read = await net.fetch({
      host: "127.0.0.1",
      port: target.port,
      path: "/r",
    });
    assertEquals(read, { status: 200, body: { ok: true } });
    assertEquals(hits, 3);

    hits = 0;
    const write = await net.fetch({
      host: "127.0.0.1",
      port: target.port,
      path: "/w",
      method: "POST",
    });
    // 쓰기는 상대의 503도 다시 보내지 않고 한 번의 답을 그대로 돌려준다.
    assertEquals(write.status, 503);
    assertEquals(hits, 1);
  } finally {
    await world.stop();
    await target.stop();
  }
});

Deno.test("apps/sdk#R30: cap-save through the real broker keeps one version for a resent request and refuses an undeclared key naming document.save", async () => {
  const world = await setup([
    requirement("document.save", { key: "weekly-report" }),
  ]);
  try {
    world.access.grant({ kind: "document.save", key: "weekly-report" });
    const save = createSaveClient({
      host: world.host(),
      sleep: () => Promise.resolve(),
    });
    const request = {
      key: "weekly-report",
      baseVersion: null,
      idempotencyKey: "retry-1",
    };
    const first = await save.save(request);
    const again = await save.save(request);
    assertEquals(first, { saved: true, version: VER(1) });
    assertEquals(again, first);
    const next = await save.save({
      key: "weekly-report",
      baseVersion: first.version,
      idempotencyKey: "retry-2",
    });
    assertEquals(next.version, VER(2));
    assertEquals(world.saves.map((entry) => entry.retry), [
      "retry-1",
      "retry-1",
      "retry-2",
    ]);
    const refused = await assertRejects(
      () => save.save({ ...request, key: "other-report" }),
      SaveError,
    );
    assertEquals(refused.code, "forbidden");
    assertEquals(refused.permission, "document.save");
    assertEquals(refused.scope, { key: "other-report" });
    assertEquals(world.saves.length, 3);
  } finally {
    await world.stop();
  }
});

Deno.test("apps/sdk#R31: cap-secret through the real broker returns only a safe result, follows grant revocation and never touches the broker in preview", async () => {
  const world = await setup([
    requirement("secret.use", { name: SECRET_NAME }),
    requirement("net.fetch", { host: "127.0.0.1", port: 8443 }),
  ]);
  try {
    const secret = createSecretClient({ host: world.host() });
    const request = {
      name: SECRET_NAME,
      destination: { host: "127.0.0.1", port: 8443 },
    };
    const noGrant = await assertRejects(() => secret.use(request), SecretError);
    assertEquals(noGrant.permission, "secret.use");
    assertEquals(noGrant.scope, { name: SECRET_NAME });
    assertEquals(world.secretRequests.length, 0);

    const secretGrant = world.access.grant({
      kind: "secret.use",
      name: SECRET_NAME,
    });
    // 목적지의 net.fetch grant가 없으면 secret grant만으로 나가지 못한다.
    const noDestination = await assertRejects(
      () => secret.use(request),
      SecretError,
    );
    assertEquals(noDestination.permission, "net.fetch");
    assertEquals(noDestination.scope, { host: "127.0.0.1", port: 8443 });
    world.access.grant({ kind: "net.fetch", host: "127.0.0.1", port: 8443 });

    const used = await secret.use(request);
    assertEquals(used, { used: true });
    assert(!JSON.stringify(used).includes(SECRET_VALUE));
    assertEquals(world.secretRequests.length, 1);
    assertEquals(world.secretRequests[0].name, SECRET_NAME);
    assertEquals(world.secretRequests[0].invocation, INV);

    // preview 자식의 client는 같은 grant가 있어도 broker에 가지 않고 대역이 답한다.
    const preview = createSecretClient({ host: world.host("preview") });
    assertEquals(await preview.use(request), { used: true, standIn: true });
    assertEquals(world.secretRequests.length, 1);

    world.access.revoke(secretGrant);
    await assertRejects(() => secret.use(request), SecretError);
    assertEquals(world.secretRequests.length, 1);
  } finally {
    await world.stop();
  }
});

Deno.test("apps/sdk#R24 apps/sdk#R30 apps/sdk#R31: the default clients of all four packages read the one host port the app process installs", async () => {
  const target = serveLocal(() => Response.json({ ok: true }));
  const world = await setup([
    requirement("net.fetch", { host: "127.0.0.1", port: target.port }),
    requirement("secret.use", { name: SECRET_NAME }),
    requirement("document.save", { key: "weekly-report" }),
  ]);
  const data = await Deno.makeTempDir({ prefix: "sdk-caps-data-" });
  const slot = globalThis as Record<symbol, unknown>;
  try {
    world.access.grant({
      kind: "net.fetch",
      host: "127.0.0.1",
      port: target.port,
    });
    world.access.grant({ kind: "secret.use", name: SECRET_NAME });
    world.access.grant({ kind: "document.save", key: "weekly-report" });
    // 두 package가 같은 symbol로 같은 port를 본다. 앱 코드는 port를 직접 만지지 않는다.
    for (
      const symbol of [
        capNet.CAP_HOST,
        capStore.CAP_HOST,
        capSave.CAP_HOST,
        capSecret.CAP_HOST,
      ] as symbol[]
    ) {
      assertEquals(symbol, Symbol.for("lophn.cap-host"));
    }
    slot[capNet.CAP_HOST] = { ...world.host(), dataPath: data };
    assertEquals(
      await capNet.netFetch({
        host: "127.0.0.1",
        port: target.port,
        path: "/x",
      }),
      { status: 200, body: { ok: true } },
    );
    assertEquals(
      await capSave.saveDocument({
        key: "weekly-report",
        baseVersion: null,
        idempotencyKey: "retry-1",
      }),
      { saved: true, version: VER(1) },
    );
    assertEquals(
      await capSecret.useSecret({
        name: SECRET_NAME,
        destination: { host: "127.0.0.1", port: target.port },
      }),
      { used: true },
    );
    const store = capStore.openStore();
    assertEquals(store.schema(), 0);
    store.close();
    assert(Deno.statSync(`${data}/app.sqlite`).isFile);
  } finally {
    delete slot[capNet.CAP_HOST];
    await world.stop();
    await target.stop();
    await Deno.remove(data, { recursive: true });
  }
});

const EXPECTED_EXPORTS = {
  "cap-fs": [
    "CapabilityError",
    "REQUIRED_PERMISSIONS",
    "checkDeclaration",
    "readFile",
    "readTextFile",
    "watch",
    "writeFile",
    "writeTextFile",
  ],
  "cap-net": [
    "CAP_HOST",
    "CapabilityError",
    "DEFAULT_READ_RETRIES",
    "DEFAULT_RETRY_DELAYS_MS",
    "DEFAULT_TIMEOUT_MS",
    "REQUIRED_PERMISSIONS",
    "checkDeclaration",
    "createNetClient",
    "netFetch",
  ],
  "cap-store": [
    "CAP_HOST",
    "CapabilityError",
    "DEFAULT_DATABASE_FILE",
    "SCHEMA_TABLE",
    "openStore",
  ],
  "cap-save": [
    "CAP_HOST",
    "CapabilityError",
    "REQUIRED_PERMISSIONS",
    "SAVE_RETRIES",
    "SAVE_RETRY_DELAYS_MS",
    "checkDeclaration",
    "createSaveClient",
    "createSaveStandIn",
    "saveDocument",
  ],
  "cap-secret": [
    "CAP_HOST",
    "CapabilityError",
    "REQUIRED_PERMISSIONS",
    "checkDeclaration",
    "createSecretClient",
    "createSecretStandIn",
    "useSecret",
  ],
} as const;

Deno.test("apps/sdk#R32: the public API of the capability clients has no path to core DB, credentials, grant issuing or closing a problem", async () => {
  assertEquals(
    Object.keys(capFs).sort(),
    [...EXPECTED_EXPORTS["cap-fs"]].sort(),
  );
  assertEquals(
    Object.keys(capNet).sort(),
    [...EXPECTED_EXPORTS["cap-net"]].sort(),
  );
  assertEquals(
    Object.keys(capStore).sort(),
    [...EXPECTED_EXPORTS["cap-store"]].sort(),
  );
  assertEquals(
    Object.keys(capSave).sort(),
    [...EXPECTED_EXPORTS["cap-save"]].sort(),
  );
  assertEquals(
    Object.keys(capSecret).sort(),
    [...EXPECTED_EXPORTS["cap-secret"]].sort(),
  );
  const forbiddenName =
    /credential|grant|approve|ledger|core|admin|problem.*(close|resolve)|(close|resolve).*problem/i;
  for (
    const module of [capFs, capNet, capStore, capSave, capSecret]
  ) {
    for (const name of Object.keys(module)) {
      assert(!forbiddenName.test(name), `${name} looks like a forbidden path`);
    }
  }
  // 원본도 같은 경계를 지킨다: 플랫폼 파일·환경·credential을 읽지 않고 apps·core를 import하지 않는다.
  const root = new URL("../../packages/sdk/", import.meta.url);
  for (const name of Object.keys(EXPECTED_EXPORTS)) {
    for await (const entry of Deno.readDir(new URL(`${name}/`, root))) {
      if (!entry.name.endsWith(".ts") || entry.name.endsWith("_test.ts")) {
        continue;
      }
      const source = await Deno.readTextFile(
        new URL(`${name}/${entry.name}`, root),
      );
      assert(
        !/Deno\.env|LOPHN_APP_BROKER|LOPHN_CREDENTIAL/.test(source),
        entry.name,
      );
      assert(
        !/from "(\.\.\/){2,}|from "@lophn\/(contracts|base)|packages\/(apps|platform)/
          .test(source),
        `${name}/${entry.name} imports outside its own package`,
      );
    }
  }
});

Deno.test("apps/sdk#R26: cap-problem needs no extra permission and exposes no way to close a problem", async () => {
  // 보고 함수와 runtime이 설치하는 보고 port뿐이다(apps#T22). 닫기·해소 API는 없다.
  assertEquals(Object.keys(capProblem).sort(), [
    "REPORTER_PORT",
    "createExceptionObserver",
    "createProblemReporter",
    "installProblemReporter",
    "reportProblem",
  ]);
  assert(
    !Object.keys(capProblem).some((name) =>
      /close|resolve|dismiss/i.test(name)
    ),
  );
  const reporter = createProblemReporter({
    transport: () =>
      Promise.resolve({
        ok: false,
        error: { code: "invalid_input", message: "x" },
      }),
    now: () => "2026-10-06T00:00:00.000Z",
    newId: (prefix) => `${prefix}_00000000000000000000000001`,
    sleep: () => Promise.resolve(),
    currentInvocation: () => null,
  });
  // 보고 함수와 대기 상태 조회뿐이다. 닫기·해소 결정 API는 없다.
  assertEquals(
    Object.getOwnPropertyNames(reporter).filter((name) =>
      !["length", "name", "prototype"].includes(name)
    ),
    ["status"],
  );
  const guide = await Deno.readTextFile(
    new URL("../../packages/sdk/cap-problem/guide.md", import.meta.url),
  );
  const permissions = guide.split("## 요구 permission")[1].split("##")[0];
  assert(permissions.includes("없다"));
  // 추가 permission이 없는 package는 선언 검사 대상도 아니다.
  assert(!("checkDeclaration" in capProblem));
});

Deno.test("apps/sdk#R25: loopback listening has no capability package and the guides send readers to Deno.serve", async () => {
  const names: string[] = [];
  for await (
    const entry of Deno.readDir(new URL("../../packages/sdk/", import.meta.url))
  ) {
    if (entry.isDirectory) names.push(entry.name);
  }
  assert(!names.some((name) => /listen|loopback|serve/.test(name)));
  const guide = await Deno.readTextFile(
    new URL("../../packages/sdk/cap-net/guide.md", import.meta.url),
  );
  assert(guide.includes("Deno.serve"));
  assert(!/@lophn\/cap-(listen|loopback|serve)/.test(guide));
});
