import { assert, assertEquals } from "@std/assert";
import { canonicalize } from "@lophn/base";
import { routePath } from "../platform/route.ts";
import {
  appCallDepthAllowed,
  appCallOriginSchema,
  appConnect,
  appConnectInputSchema,
  appConnectionSchema,
  appConnectOutputSchema,
  appScreenRequestSchema,
  confirmExecutionProofSchema,
  confirmProofSigningBytes,
  connectionSigningBytes,
  invocationCallerSchema,
  signedConfirmProofSchema,
  signedConnectionSchema,
} from "./channel.ts";
import { APP_CALL_DEPTH_LIMIT } from "./channel-values.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER = "app_01h455vb4pex5v6nkc6gd5fdw8";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const GRANT = "grt_01h455vb4pex5v6nkc6gd5fdw1";
const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";
const RUN = "run_01h455vb4pex5v6nkc6gd5fdw1";
const TOOL = "tcl_01h455vb4pex5v6nkc6gd5fdw1";
const HASH = "ab".repeat(32);
const AT = "2026-10-04T00:00:00.000Z";

const connection = {
  app: APP,
  release: REL,
  bundle_hash: HASH,
  mode: "live" as const,
  process_nonce: "nonce-1",
  actor: "user" as const,
  credential_ref: "cred-1",
  screens: ["usage"],
  screen_sizes: { usage: ["full" as const, "panel" as const] },
  caller: null,
  commands: ["usage.list"],
  expires_at: AT,
};

Deno.test("apps/runtime#R5, apps/runtime#R31, apps/preview#R7: POST /v1/apps/connect 입력·출력과 AppConnection·AppScreenRequest", () => {
  const input = {
    app: APP,
    mode: "live" as const,
    screens: ["usage"],
    screen_sizes: { usage: ["full" as const] },
    commands: ["usage.list"],
  };
  assert(appConnectInputSchema.safeParse(input).success);
  assert(
    appConnectInputSchema.safeParse({ ...input, mode: "preview" }).success ===
      false,
  );
  assert(
    appConnectInputSchema.safeParse({
      ...input,
      mode: "preview",
      preview_nonce: "preview-1",
    }).success,
  );
  const output = appConnectOutputSchema.parse({
    endpoint: "/run/user/lophn/a-1.sock",
    connection,
    signature: "A".repeat(86),
  });
  assertEquals(output.connection.mode, "live");
  // 서명 없는 connection은 앱이 받지 않으므로 출력에도 없을 수 없다.
  assert(
    appConnectOutputSchema.safeParse({
      endpoint: "/run/user/lophn/a-1.sock",
      connection,
    }).success === false,
  );
  assert(
    appConnectInputSchema.safeParse({ ...input, mode: "test" }).success ===
      false,
  );
  assert(
    appConnectionSchema.safeParse({ ...connection, mode: "test" }).success,
  );
  assertEquals(
    routePath({ resource: "apps", method: "connect" }),
    "/v1/apps/connect",
  );
  assert(
    appConnectionSchema.safeParse({ ...connection, release: null }).success ===
      false,
  );
  assert(
    appConnectionSchema.safeParse({
      ...connection,
      mode: "preview",
      release: null,
    }).success,
  );
  assert(
    appScreenRequestSchema.safeParse({
      screen: "usage",
      size: "card",
      view_session: "view-1",
    }).success,
  );
  assert(
    appScreenRequestSchema.safeParse({
      screen: "usage",
      size: "wide",
      view_session: "view-1",
    }).success === false,
  );
});

Deno.test("apps/connections#R5, apps/connections#R7, apps/invocations#R16, apps/invocations#R17: AppCallOrigin·AgentCallOrigin·InvocationCaller", () => {
  const origin = appCallOriginSchema.parse({
    kind: "app",
    app: APP,
    release: REL,
    process_nonce: "nonce-1",
    grant: GRANT,
    parent_invocation: null,
    path: [APP],
  });
  assertEquals(origin.path.length, 1);
  assert(
    appCallOriginSchema.safeParse({ ...origin, path: [APP, APP] }).success ===
      false,
  );
  const chain = [
    APP,
    "app_01h455vb4pex5v6nkc6gd5fdw2",
    "app_01h455vb4pex5v6nkc6gd5fdw3",
    "app_01h455vb4pex5v6nkc6gd5fdw4",
    "app_01h455vb4pex5v6nkc6gd5fdw5",
    "app_01h455vb4pex5v6nkc6gd5fdw6",
    "app_01h455vb4pex5v6nkc6gd5fdw7",
  ];
  assert(
    appCallOriginSchema.safeParse({ ...origin, app: chain[6], path: chain })
      .success,
  );
  assert(
    appCallOriginSchema.safeParse({
      ...origin,
      app: OTHER,
      path: [...chain, OTHER],
    }).success === false,
  );
  assertEquals(APP_CALL_DEPTH_LIMIT, 8);
  // path 7개에 새 앱을 더하면 8개라 허용, 8개 체인에 새 앱은 9개라 거절.
  assertEquals(appCallDepthAllowed(chain, OTHER), true);
  assertEquals(
    appCallDepthAllowed([...chain, OTHER], "app_01h455vb4pex5v6nkc6gd5fdwa"),
    false,
  );
  assertEquals(appCallDepthAllowed([APP, OTHER], APP), false);
  const caller = invocationCallerSchema.parse({
    kind: "app",
    app: origin.app,
    release: origin.release,
    parent_invocation: origin.parent_invocation,
  });
  assertEquals("process_nonce" in caller, false);
  assert(
    invocationCallerSchema.safeParse({
      kind: "agent",
      run: RUN,
      tool_call: TOOL,
    }).success,
  );
  const proof = confirmExecutionProofSchema.parse({
    invocation: INV,
    process_nonce: "nonce-1",
    release: REL,
    command: "usage.save",
    input_hash: HASH,
    caller,
    expires_at: AT,
  });
  assertEquals(proof.caller.kind, "app");
});

Deno.test("apps/runtime#R11: connect는 ledger command가 아닌 memory route다", () => {
  assertEquals(appConnect.kind, "memory");
  assertEquals(routePath(appConnect), "/v1/apps/connect");
  assertEquals(appConnect.name, "app.connect");
});

Deno.test("apps/runtime#R11, apps/connections#R5: 모르는 field와 틀린 ID 접두사를 거절한다", () => {
  assert(
    appConnectInputSchema.safeParse({
      app: APP,
      mode: "live",
      screens: ["usage"],
      screen_sizes: { usage: ["full"] },
      commands: ["usage.list"],
      extra: true,
    }).success === false,
  );
  assert(
    appConnectInputSchema.safeParse({
      app: "rel_01h455vb4pex5v6nkc6gd5fdw1",
      mode: "live",
      screens: ["usage"],
      screen_sizes: { usage: ["full"] },
      commands: ["usage.list"],
    }).success === false,
  );
  assert(
    appCallOriginSchema.safeParse({
      kind: "app",
      app: APP,
      release: "app_01h455vb4pex5v6nkc6gd5fdw1",
      process_nonce: "nonce-1",
      grant: GRANT,
      parent_invocation: null,
      path: [APP],
    }).success === false,
  );
  assert(
    confirmExecutionProofSchema.safeParse({
      invocation: "apr_01h455vb4pex5v6nkc6gd5fdw1",
      process_nonce: "nonce-1",
      release: REL,
      command: "usage.save",
      input_hash: HASH,
      caller: { kind: "direct" },
      expires_at: AT,
      note: "x",
    }).success === false,
  );
  // screen_sizes는 요청 screen의 부분집합이면 된다. 선언 대조는 runtime이다.
  assert(
    appConnectInputSchema.safeParse({
      app: APP,
      mode: "live",
      screens: ["usage", "report"],
      screen_sizes: { usage: ["full"] },
      commands: ["usage.list"],
    }).success,
  );
  assert(
    appConnectInputSchema.safeParse({
      app: APP,
      mode: "live",
      screens: ["usage"],
      screen_sizes: { report: ["card"] },
      commands: ["usage.list"],
    }).success === false,
  );
});

Deno.test("apps/runtime#R11: 서명 envelope는 payload와 base64url signature만 싣는다", async () => {
  const signature = "A".repeat(86);
  const signed = signedConnectionSchema.parse({
    payload: connection,
    signature,
  });
  assertEquals(
    connectionSigningBytes(signed.payload),
    canonicalize(connection),
  );
  assert(
    signedConnectionSchema.safeParse({ payload: connection }).success === false,
  );
  assert(
    signedConnectionSchema.safeParse({
      payload: connection,
      signature: "short",
    }).success === false,
  );
  const proof = confirmExecutionProofSchema.parse({
    invocation: INV,
    process_nonce: "nonce-1",
    release: REL,
    command: "usage.save",
    input_hash: HASH,
    caller: { kind: "direct" },
    expires_at: AT,
  });
  const signedProof = signedConfirmProofSchema.parse({
    payload: proof,
    signature,
  });
  assertEquals(confirmProofSigningBytes(signedProof.payload).length > 0, true);
  const key = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const bytes = new TextEncoder().encode(connectionSigningBytes(connection));
  const raw = new Uint8Array(
    await crypto.subtle.sign("Ed25519", key.privateKey, bytes),
  );
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let encoded = "";
  for (let index = 0; index < raw.length; index += 3) {
    const a = raw[index] ?? 0;
    const b = raw[index + 1] ?? 0;
    const c = raw[index + 2] ?? 0;
    encoded += alphabet[a >> 2];
    encoded += alphabet[((a & 3) << 4) | (b >> 4)];
    if (index + 1 < raw.length) encoded += alphabet[((b & 15) << 2) | (c >> 6)];
    if (index + 2 < raw.length) encoded += alphabet[c & 63];
  }
  assert(
    signedConnectionSchema.safeParse({
      payload: connection,
      signature: encoded,
    }).success,
  );
  assert(
    await crypto.subtle.verify(
      "Ed25519",
      key.publicKey,
      raw,
      bytes,
    ),
  );
});

Deno.test("apps/runtime#R11: 서명 대상은 key 순서가 달라도 같은 canonical bytes다", () => {
  const swapped: Record<string, unknown> = {};
  for (const key of Object.keys(connection).reverse()) {
    swapped[key] = (connection as Record<string, unknown>)[key];
  }
  assertEquals(
    connectionSigningBytes(swapped as typeof connection),
    connectionSigningBytes(connection),
  );
  const proof = confirmExecutionProofSchema.parse({
    invocation: INV,
    process_nonce: "nonce-1",
    release: REL,
    command: "usage.save",
    input_hash: HASH,
    caller: { kind: "direct" },
    expires_at: AT,
  });
  const reversed: Record<string, unknown> = {};
  for (const key of Object.keys(proof).reverse()) {
    reversed[key] = (proof as Record<string, unknown>)[key];
  }
  assertEquals(
    confirmProofSigningBytes(reversed as typeof proof),
    confirmProofSigningBytes(proof),
  );
  assertEquals(canonicalize({ "10": 10, "2": 2 }), '{"10":10,"2":2}');
  assertEquals(
    canonicalize({ "2": 2, "10": 10, nested: { b: 1, a: 2 } }),
    canonicalize({ nested: { a: 2, b: 1 }, "10": 10, "2": 2 }),
  );
});
