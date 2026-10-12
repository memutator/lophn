import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  commandsResult,
  healthObservationSchema,
  identityCurrent,
  platformHealth,
  platformStatus,
} from "./platform-routes.ts";
import { routePath } from "./route.ts";

const at = "2026-10-04T00:00:00.000Z";
const meta = { as_of_seq: "3", next_cursor: null };
Deno.test("platform/identity#R11: status·health를 포함한 네 read route가 인증 actor와 오류를 등록한다", () => {
  const routes = [
    platformStatus,
    platformHealth,
    identityCurrent,
    commandsResult,
  ];
  assertEquals(routes.map(routePath), [
    "/v1/platform/status",
    "/v1/platform/health",
    "/v1/identity/current",
    "/v1/commands/result",
  ]);
  for (const route of routes) {
    assertEquals(route.kind, "read");
    assert(route.actors.length === 5);
    assert(route.errors.includes("unauthorized"));
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
    assert(!route.input.safeParse({ token: "raw" }).success);
  }
  assert(
    platformStatus.output.safeParse({
      ...meta,
      ready: true,
      schema: 1,
      data_root: "H",
      ledger_id: "ledger-generation",
      components: [],
    }).success,
  );
  assert(
    !platformStatus.output.safeParse({
      ...meta,
      ready: true,
      schema: 1,
      data_root: "H",
      components: [],
    }).success,
  );
  assert(
    platformHealth.output.safeParse({
      ...meta,
      observations: [{ component: "writer", available: true, observed_at: at }],
      observed_at: at,
    }).success,
  );
  assert(
    !healthObservationSchema.safeParse({
      component: "writer",
      available: false,
      observed_at: at,
    }).success,
  );
});
Deno.test("platform/identity#R3 platform/identity#R6: current는 actor·scope·조건만 내놓는다", () => {
  const current = identityCurrent.output.parse({
    ...meta,
    actor: "user",
    scope: { operations: [], targets: {} },
    conditions: {},
    token: "raw",
    credential_ref: "ref",
  });
  assert(!("token" in current));
  assert(!("credential_ref" in current));
  assert(!identityCurrent.input.safeParse({ actor: "machine" }).success);
});
Deno.test("platform/identity#R10 platform/ledger#R3: result 조회는 자기 key만 받고 확정 결과나 안전한 null이다", () => {
  assert(commandsResult.input.safeParse({ idempotency_key: "key" }).success);
  assert(
    !commandsResult.input.safeParse({
      idempotency_key: "key",
      principal: "other",
    }).success,
  );
  assert(!commandsResult.input.safeParse({ idempotency_key: "" }).success);
  assert(commandsResult.output.safeParse({ ...meta, result: null }).success);
  const result = {
    principal: "p",
    idempotency_key: "key",
    fingerprint: "a".repeat(64),
    result: { saved: true },
    first_seq: "1",
    last_seq: "3",
    at,
  };
  assert(commandsResult.output.safeParse({ ...meta, result }).success);
  assert(
    !commandsResult.output.safeParse({
      ...meta,
      result: { ...result, last_seq: null },
    }).success,
  );
  assert(
    !commandsResult.output.safeParse({
      ...meta,
      result: { ...result, last_seq: "0" },
    }).success,
  );
});
