import { assert, assertEquals } from "@std/assert";
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
  invocationCallerSchema,
} from "./channel.ts";
import { APP_CALL_DEPTH_LIMIT, APP_CALL_PATH_MAX } from "./channel-values.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER = "app_01h455vb4pex5v6nkc6gd5fdw2";
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
  });
  assertEquals(output.connection.mode, "live");
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
  assert(
    appCallOriginSchema.safeParse({
      ...origin,
      path: Array.from({ length: APP_CALL_PATH_MAX + 1 }, () => OTHER),
    }).success === false,
  );
  assertEquals(APP_CALL_DEPTH_LIMIT, 8);
  assertEquals(appCallDepthAllowed([APP], OTHER), true);
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
