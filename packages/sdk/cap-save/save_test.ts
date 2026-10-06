import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  type BrokerResponse,
  CapabilityError,
  type CapHost,
  checkDeclaration,
  createSaveClient,
  createSaveStandIn,
  type RuntimeMode,
} from "./mod.ts";

const CALL = {
  command: "export_report",
  inputHash: "ab".repeat(32),
  release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
  invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
};

const VER1 = "ver_00000000000000000000000001";

type Script = (
  attempt: number,
  body: Record<string, unknown>,
) => Promise<BrokerResponse> | BrokerResponse;

function host(script: Script, mode: RuntimeMode = "live") {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const fake: CapHost = {
    mode,
    post(path, body) {
      posts.push({ path, body });
      return Promise.resolve(script(posts.length, body));
    },
    call: () => CALL,
  };
  return { fake, posts };
}

function client(fake: CapHost) {
  const sleeps: number[] = [];
  return {
    save: createSaveClient({
      host: fake,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    }),
    sleeps,
  };
}

const request = {
  key: "weekly-report",
  baseVersion: null,
  idempotencyKey: "retry-1",
};

Deno.test("apps/sdk#R30: cap-save sends the declared key, expected version and retry key and returns the confirmed version", async () => {
  const { fake, posts } = host(() => ({
    status: 200,
    body: { saved: true, version: VER1 },
  }));
  const { save } = client(fake);
  assertEquals(await save.save(request), { saved: true, version: VER1 });
  assertEquals(posts, [{
    path: "/_lophn/broker/documents/save",
    body: {
      key: "weekly-report",
      base_version: null,
      idempotency_key: "retry-1",
    },
  }]);
});

Deno.test("apps/sdk#R30: cap-save resends a lost request with the same retry key and gets one version", async () => {
  // documents 저장 대역은 같은 (key, 재전송 key)를 version 하나로 센다.
  const stored = new Map<string, string>();
  let versions = 0;
  const { fake, posts } = host((attempt, body) => {
    const retry = `${body.key}/${body.idempotency_key}`;
    if (!stored.has(retry)) {
      versions += 1;
      stored.set(retry, `ver_${String(versions).padStart(26, "0")}`);
    }
    // 첫 응답은 저장 뒤에 유실된다.
    return attempt === 1
      ? Promise.reject(new Error("response lost"))
      : { status: 200, body: { saved: true, version: stored.get(retry) } };
  });
  const { save, sleeps } = client(fake);
  const result = await save.save(request);
  assertEquals(result.version, "ver_00000000000000000000000001");
  assertEquals(versions, 1);
  assertEquals(posts.length, 2);
  assertEquals(posts[0].body, posts[1].body);
  assertEquals(sleeps, [200]);
});

Deno.test("apps/sdk#R30: cap-save gives up after the retries with an unknown outcome and the same-key hint", async () => {
  const { fake, posts } = host(() => ({
    status: 503,
    body: { error: { code: "unavailable", message: "broker is closing" } },
  }));
  const { save } = client(fake);
  const error = await assertRejects(() => save.save(request), CapabilityError);
  assertEquals(error.code, "unavailable");
  assertEquals(error.outcome, "unknown");
  assert(error.message.includes("same idempotencyKey"));
  assertEquals(posts.length, 3);
});

Deno.test("apps/sdk#R30: cap-save surfaces a version conflict without retrying", async () => {
  const { fake, posts } = host(() => ({
    status: 409,
    body: { error: { code: "conflict", message: "base version is stale" } },
  }));
  const { save } = client(fake);
  const error = await assertRejects(() => save.save(request), CapabilityError);
  assertEquals(error.code, "conflict");
  assertEquals(posts.length, 1);
});

Deno.test("apps/sdk#R23: cap-save refusal names document.save and the key", async () => {
  const { fake } = host(() => ({
    status: 403,
    body: {
      error: {
        code: "forbidden",
        message: "document.save is not permitted for this scope",
        details: { permission: "document.save", scope: { key: "other" } },
      },
    },
  }));
  const { save } = client(fake);
  const error = await assertRejects(
    () => save.save({ ...request, key: "other" }),
    CapabilityError,
  );
  assertEquals(error.permission, "document.save");
  assertEquals(error.scope, { key: "other" });
  assert(error.message.includes("other"));
});

Deno.test("apps/sdk#R30: cap-save stand-in keeps versions in memory with the same rules", async () => {
  const standIn = createSaveStandIn();
  const { fake, posts } = host(
    () => ({ status: 200, body: { saved: true, version: VER1 } }),
    "preview",
  );
  const preview = createSaveClient({ host: fake, standIn });
  const first = await preview.save(request);
  assertEquals(first.standIn, true);
  assertEquals(await preview.save(request), first);
  assertEquals(standIn.versions.get("weekly-report")?.length, 1);
  const second = await preview.save({
    key: "weekly-report",
    baseVersion: first.version,
    idempotencyKey: "retry-2",
  });
  assertEquals(standIn.versions.get("weekly-report")?.length, 2);
  assert(second.version !== first.version);
  const stale = await assertRejects(
    () =>
      preview.save({
        key: "weekly-report",
        baseVersion: first.version,
        idempotencyKey: "retry-3",
      }),
    CapabilityError,
  );
  assertEquals(stale.code, "conflict");
  assertEquals(posts.length, 0);
});

Deno.test("apps/sdk#R30: cap-save rejects a request without a key or retry key before sending", async () => {
  const { fake, posts } = host(() => ({
    status: 200,
    body: { saved: true, version: VER1 },
  }));
  const { save } = client(fake);
  for (
    const bad of [
      { ...request, key: " " },
      { ...request, idempotencyKey: "" },
      { ...request, baseVersion: 3 as unknown as string },
    ]
  ) {
    await assertRejects(() => save.save(bad), CapabilityError);
  }
  assertEquals(posts.length, 0);
});

Deno.test("apps/sdk#R22: a declaration that uses cap-save without document.save is rejected", () => {
  const using = [{ name: "@lophn/cap-save" }];
  const refused = checkDeclaration({
    sdk_dependencies: using,
    permissions: [{ kind: "fs.write" }],
  });
  assert(!refused.ok);
  assertEquals(refused.error.permissions, ["document.save"]);
  assert(
    checkDeclaration({
      sdk_dependencies: using,
      permissions: [{ kind: "document.save" }],
    }).ok,
  );
});
