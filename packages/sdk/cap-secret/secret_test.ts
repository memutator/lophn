import { assert, assertEquals, assertRejects } from "@std/assert";
import * as api from "./mod.ts";
import {
  type BrokerResponse,
  CapabilityError,
  type CapHost,
  checkDeclaration,
  createSecretClient,
  createSecretStandIn,
  type RuntimeMode,
} from "./mod.ts";

const CALL = {
  command: "sync",
  inputHash: "ab".repeat(32),
  release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
  invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
};

function host(
  answer: () => BrokerResponse,
  mode: RuntimeMode = "live",
) {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const fake: CapHost = {
    mode,
    post(path, body) {
      posts.push({ path, body });
      return Promise.resolve(answer());
    },
    call: () => CALL,
  };
  return { fake, posts };
}

const request = {
  name: "calendar.token",
  destination: { host: "api.example.test", port: 443 },
};

Deno.test("apps/sdk#R31: cap-secret asks the broker to attach the secret and gets only a safe use result", async () => {
  const { fake, posts } = host(() => ({ status: 200, body: { used: true } }));
  const result = await createSecretClient({ host: fake }).use(request);
  assertEquals(result, { used: true });
  assertEquals(posts, [{
    path: "/_lophn/broker/secrets/use",
    body: {
      release: CALL.release,
      invocation: CALL.invocation,
      command: "sync",
      input_hash: CALL.inputHash,
      name: "calendar.token",
      destination: { scheme: "https", host: "api.example.test", port: 443 },
    },
  }]);
});

Deno.test("apps/sdk#R31: cap-secret has no way to read, create, replace or delete a secret", () => {
  const names = Object.keys(api).sort();
  assertEquals(
    names,
    [
      "CAP_HOST",
      "REQUIRED_PERMISSIONS",
      "CapabilityError",
      "checkDeclaration",
      "createSecretClient",
      "createSecretStandIn",
      "useSecret",
    ].sort(),
  );
  const client = createSecretClient({
    host: host(() => ({ status: 200, body: { used: true } })).fake,
  });
  assertEquals(Object.keys(client), ["use"]);
  assertEquals(Object.keys(createSecretStandIn()).sort(), ["use", "uses"]);
});

Deno.test("apps/sdk#R23: cap-secret refusal names secret.use and the secret name", async () => {
  const { fake } = host(() => ({
    status: 403,
    body: {
      error: {
        code: "forbidden",
        message: "secret.use is not permitted for this scope",
        details: {
          permission: "secret.use",
          scope: { name: "calendar.token" },
        },
      },
    },
  }));
  const error = await assertRejects(
    () => createSecretClient({ host: fake }).use(request),
    CapabilityError,
  );
  assertEquals(error.code, "forbidden");
  assertEquals(error.permission, "secret.use");
  assertEquals(error.scope, { name: "calendar.token" });
  assert(error.message.includes("calendar.token"));
});

Deno.test("apps/sdk#R31: cap-secret does not retry an interrupted use and says the outcome is unknown", async () => {
  let calls = 0;
  const fake: CapHost = {
    mode: "live",
    post() {
      calls += 1;
      return Promise.reject(new Error("socket closed"));
    },
    call: () => CALL,
  };
  const error = await assertRejects(
    () => createSecretClient({ host: fake }).use(request),
    CapabilityError,
  );
  assertEquals(error.code, "unavailable");
  assertEquals(error.outcome, "unknown");
  assertEquals(calls, 1);
});

Deno.test("apps/sdk#R31: cap-secret uses a stand-in in preview and test and never calls the broker", async () => {
  for (const mode of ["preview", "test"] as const) {
    const { fake, posts } = host(
      () => ({ status: 200, body: { used: true } }),
      mode,
    );
    const standIn = createSecretStandIn({ allowed: ["calendar.token"] });
    const client = createSecretClient({ host: fake, standIn });
    assertEquals(await client.use(request), { used: true, standIn: true });
    assertEquals(posts.length, 0);
    assertEquals(standIn.uses, [request]);
    const error = await assertRejects(
      () => client.use({ ...request, name: "other.token" }),
      CapabilityError,
    );
    assertEquals(error.permission, "secret.use");
    assertEquals(error.scope, { name: "other.token" });
  }
});

Deno.test("apps/sdk#R22: cap-secret import alone grants nothing and needs a host", async () => {
  const error = await assertRejects(
    () => createSecretClient().use(request),
    CapabilityError,
  );
  assertEquals(error.code, "unavailable");
});

Deno.test("apps/sdk#R22: a declaration that uses cap-secret needs secret.use and net.fetch", () => {
  const using = [{ name: "@lophn/cap-secret" }];
  const noSecret = checkDeclaration({
    sdk_dependencies: using,
    permissions: [{ kind: "net.fetch" }],
  });
  assert(!noSecret.ok);
  assertEquals(noSecret.error.permissions, ["secret.use"]);
  const noNet = checkDeclaration({
    sdk_dependencies: using,
    permissions: [{ kind: "secret.use" }],
  });
  assert(!noNet.ok);
  assertEquals(noNet.error.permissions, ["net.fetch"]);
  assert(
    checkDeclaration({
      sdk_dependencies: using,
      permissions: [{ kind: "secret.use" }, { kind: "net.fetch" }],
    }).ok,
  );
});
