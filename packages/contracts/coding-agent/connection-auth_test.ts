import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  CodingAgentConnectionAuth,
  codingAgentConnectionAuthResultSchema,
  CREDENTIAL_DELIVERY_FAILURES,
  CREDENTIAL_DELIVERY_TIMEOUT_MS,
  CREDENTIAL_HELPER,
  credentialDeliveryErrorCode,
  credentialDeliveryFailureSchema,
  credentialDeliveryRequestSchema,
  credentialDeliveryResponseSchema,
} from "./connection-auth.ts";
import { connectionPrincipal } from "./connections.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const DIGEST = "cd".repeat(32);

Deno.test("coding-agent/connection#R3, coding-agent/connection#R9: 인증 port는 principal로 digest와 상태를 돌려준다", () => {
  assertEquals(CodingAgentConnectionAuth.name, "CodingAgentConnectionAuth");
  const result = codingAgentConnectionAuthResultSchema.parse({
    connection: CAC,
    state: "active",
    scope: { kind: "app", app: APP },
    token_digest: DIGEST,
    revision: "4",
  });
  assertEquals(result.connection, CAC);
  assert(
    !codingAgentConnectionAuthResultSchema.safeParse({
      ...result,
      state: "expired",
    }).success,
  );
  assert(
    !codingAgentConnectionAuthResultSchema.safeParse({
      ...result,
      scope: { kind: "all", app: APP },
    }).success,
  );
  // 출력은 모르는 field를 버리고 원문 token을 담지 않는다.
  const stripped = codingAgentConnectionAuthResultSchema.parse({
    ...result,
    token: "raw",
  });
  assertEquals("token" in stripped, false);
  assertEquals(connectionPrincipal(CAC), `coding_agent:${CAC}`);
});

Deno.test("coding-agent/connection#R15, coding-agent/connection#R17: loader 보호 전달은 helper stdin·stdout이고 실패는 unavailable이다", () => {
  assertEquals(CREDENTIAL_HELPER, "lophn-credential");
  assertEquals(CREDENTIAL_DELIVERY_TIMEOUT_MS, 5_000);
  const request = credentialDeliveryRequestSchema.parse({
    connection: CAC,
    process_generation: "gen-1",
    loader_identity: "loader-1",
    purpose: "mcp_cli_loader",
  });
  assertEquals("token" in request, false);
  credentialDeliveryRequestSchema.parse({
    ...request,
    purpose: "coding_tui",
    start_operation: "start",
  });
  const response = credentialDeliveryResponseSchema.parse({
    token: "raw-token",
  });
  assertEquals(response.token, "raw-token");

  assert(
    !credentialDeliveryRequestSchema.safeParse({ ...request, token: "raw" })
      .success,
  );
  assert(
    !credentialDeliveryRequestSchema.safeParse({
      ...request,
      connection: "app_01h455vb4pex5v6nkc6gd5fdw1",
    }).success,
  );
  assert(
    !credentialDeliveryRequestSchema.safeParse({ ...request, purpose: "shell" })
      .success,
  );
  assert(!credentialDeliveryResponseSchema.safeParse({ token: "" }).success);
  assert(!credentialDeliveryResponseSchema.safeParse({}).success);

  const known = new Set<string>(ERROR_CODES);
  for (const reason of CREDENTIAL_DELIVERY_FAILURES) {
    const body = credentialDeliveryFailureSchema.parse({ reason });
    assertEquals(body.reason, reason);
    const code = credentialDeliveryErrorCode(reason);
    assertEquals(code, "unavailable");
    assert(known.has(code));
  }
  assert(
    !credentialDeliveryFailureSchema.safeParse({ reason: "denied" }).success,
  );
});
