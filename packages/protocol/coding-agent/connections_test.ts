import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { commandRequestSchema } from "../server/envelope.ts";
import { eventEnvelopeSchema } from "../events/events.ts";
import { routePath } from "../server/route.ts";
import { ROUTES as PLATFORM_ROUTES } from "../server/registry.ts";
import {
  CODING_AGENT_CONNECTION_REVOKE,
  codingAgentConnectionCreated,
  codingAgentConnectionRevoked,
  CONNECTION_EVENTS,
  CONNECTION_ROUTES,
  connectionConnect,
  connectionConnectInputSchema,
  connectionConnectOutputSchema,
  connectionCreate,
  connectionCreateInputSchema,
  connectionCreateOutputSchema,
  connectionEndChild,
  connectionEndConnection,
  connectionListInputSchema,
  connectionListOutputSchema,
  connectionPrincipal,
  connectionRegisterChild,
  connectionRegisterChildInputSchema,
  connectionRevoke,
  connectionRevokeInputSchema,
  connectionRevokeOutputSchema,
  connectionScopeSchema,
  connectionShowInputSchema,
  connectionShowOutputSchema,
} from "./connections.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const DIGEST = "ab".repeat(32);
const AT = "2026-10-04T00:00:00.000Z";
const META = { as_of_seq: "4", next_cursor: null };

const allScope = { kind: "all" as const, app: null };
const appScope = { kind: "app" as const, app: APP };

const connection = {
  id: CAC,
  label: "claude code",
  scope: allScope,
  principal: connectionPrincipal(CAC),
  state: "active" as const,
  revision: "4",
};

Deno.test("coding-agent/connection#R1, coding-agent/connection#R2, coding-agent/connection#R4: route와 event 이름은 architecture 5.3과 같다", () => {
  assertEquals(
    CONNECTION_ROUTES.map((route) => [route.kind, routePath(route)]),
    [
      ["read", "/v1/coding_agent_connections/list"],
      ["read", "/v1/coding_agent_connections/show"],
      ["command", "/v1/coding_agent_connections/create"],
      ["memory", "/v1/coding_agent_connections/connect"],
      ["memory", "/v1/coding_agent_connections/register_child"],
      ["memory", "/v1/coding_agent_connections/end_child"],
      ["memory", "/v1/coding_agent_connections/end_connection"],
      ["command", "/v1/coding_agent_connections/revoke"],
    ],
  );
  assertEquals(CONNECTION_EVENTS.map((event) => event.type), [
    "CodingAgentConnectionCreated",
    "CodingAgentConnectionRevoked",
  ]);
  assertEquals(connectionCreate.actors, ["user"]);
  assertEquals(connectionRevoke.actors, ["user"]);
  assertEquals(connectionCreate.confirmation, undefined);
  assertEquals(connectionRevoke.confirmation, "required");
  assertEquals(connectionRevoke.binding, ["connection", "base_revision"]);
  assertEquals(
    CODING_AGENT_CONNECTION_REVOKE,
    "coding_agent_connection_revoke",
  );
});

Deno.test("coding-agent/connection#R2, coding-agent/connection#R4: 예시 입력이 통과하고 출력에 원문과 digest가 없다", () => {
  const created = connectionCreateInputSchema.parse({
    id: CAC,
    label: "claude code",
    scope: allScope,
    token_digest: DIGEST,
  });
  assertEquals(created.scope, allScope);
  const output = connectionCreateOutputSchema.parse({ connection });
  assertEquals("token" in output.connection, false);
  assertEquals("token_digest" in output.connection, false);
  assertEquals("token_hash" in output.connection, false);

  connectionListOutputSchema.parse({
    ...META,
    connections: [connection, { ...connection, scope: appScope }],
  });
  connectionShowOutputSchema.parse({ ...META, connection });

  const revoke = commandRequestSchema(connectionRevoke).parse({
    input: { connection: CAC, base_revision: "4" },
    idempotency_key: "revoke-1",
    compare: { base_revision: "4" },
    prepared: [],
    confirmation: "A".repeat(43),
  });
  assertEquals(revoke.confirmation?.length, 43);
  const revoked = connectionRevokeOutputSchema.parse({
    connection: { ...connection, state: "revoked", revision: "5" },
  });
  assertEquals(revoked.connection.state, "revoked");

  eventEnvelopeSchema(codingAgentConnectionCreated).parse({
    seq: "4",
    type: "CodingAgentConnectionCreated",
    subject: CAC,
    actor: "user",
    run: null,
    payload: {
      label: "claude code",
      scope: allScope,
      principal: connection.principal,
    },
    at: AT,
  });
  eventEnvelopeSchema(codingAgentConnectionRevoked).parse({
    seq: "5",
    type: "CodingAgentConnectionRevoked",
    subject: CAC,
    actor: "user",
    run: null,
    payload: { before_revision: "4" },
    at: AT,
  });
});

Deno.test("coding-agent/connection#R2, coding-agent/connection#R3: scope는 all과 app 하나뿐이고 섞이면 거절한다", () => {
  assertEquals(connectionScopeSchema.parse(allScope), allScope);
  assertEquals(connectionScopeSchema.parse(appScope).app, APP);
  assert(!connectionScopeSchema.safeParse({ kind: "all", app: APP }).success);
  assert(!connectionScopeSchema.safeParse({ kind: "app", app: null }).success);
  assert(!connectionScopeSchema.safeParse({ kind: "app" }).success);
  assert(
    !connectionScopeSchema.safeParse({ kind: "project", app: null }).success,
  );
});

Deno.test("coding-agent/connection#R2, coding-agent/connection#R17: 모르는 field·틀린 값·틀린 ID 접두사를 거절한다", () => {
  const input = {
    id: CAC,
    label: "claude code",
    scope: allScope,
    token_digest: DIGEST,
  };
  assert(
    !connectionCreateInputSchema.safeParse({ ...input, token: "raw" }).success,
  );
  assert(
    !connectionCreateInputSchema.safeParse({ ...input, label: "   " }).success,
  );
  assert(
    !connectionCreateInputSchema.safeParse({ ...input, token_digest: "AB" })
      .success,
  );
  assert(
    !connectionCreateInputSchema.safeParse({
      ...input,
      id: "app_01h455vb4pex5v6nkc6gd5fdw1",
    }).success,
  );
  assert(
    !connectionCreateInputSchema.safeParse({
      ...input,
      scope: { kind: "app", app: CAC },
    }).success,
  );
  assert(
    !connectionCreateOutputSchema.safeParse({
      connection: { ...connection, principal: `coding_agent:${APP}` },
    }).success,
  );

  assert(!connectionRevokeInputSchema.safeParse({ connection: CAC }).success);
  assert(
    !connectionRevokeInputSchema.safeParse({
      connection: "tkt_01h455vb4pex5v6nkc6gd5fdw1",
      base_revision: "4",
    }).success,
  );
  assert(
    !commandRequestSchema(connectionRevoke).safeParse({
      input: { connection: CAC, base_revision: "4" },
      idempotency_key: "revoke-1",
      compare: { base_revision: "4" },
      prepared: [],
    }).success,
  );
  // create는 확인 창이 없다. confirmation 없이 요청이 통과한다.
  commandRequestSchema(connectionCreate).parse({
    input,
    idempotency_key: "create-1",
    compare: {},
    prepared: [],
  });

  assert(!connectionListInputSchema.safeParse({ cursor: "" }).success);
  assert(
    !connectionShowInputSchema.safeParse({ connection: CAC, extra: true })
      .success,
  );
  // event payload는 출력이다. 검증 digest를 실어도 결과에 남지 않는다.
  const createdEvent = codingAgentConnectionCreated.payload.parse({
    label: "claude code",
    scope: allScope,
    principal: connection.principal,
    token_digest: DIGEST,
  });
  assertEquals("token_digest" in createdEvent, false);
  eventEnvelopeSchema(codingAgentConnectionCreated).parse({
    seq: "4",
    type: "CodingAgentConnectionCreated",
    subject: CAC,
    actor: "user",
    run: null,
    payload: createdEvent,
    at: AT,
  });
});

Deno.test("coding-agent/connection#R2, coding-agent/connection#R8: 오류 코드는 공통 7종 안이고 문서가 적은 코드만 낸다", () => {
  const known = new Set<string>(ERROR_CODES);
  for (const route of CONNECTION_ROUTES) {
    for (const code of route.errors) assert(known.has(code));
  }
  assertEquals(connectionCreate.errors, [
    "invalid_input",
    "forbidden",
    "conflict",
  ]);
  assertEquals(connectionRevoke.errors, ["not_found", "forbidden", "conflict"]);
  for (const route of PLATFORM_ROUTES) {
    assert(route.resource !== "coding_agent_connections");
  }
});

Deno.test("coding-agent/connection#R2: 연결 결정 입구는 사람만 부르고 이름·범위만 받으며 결과에 token·hash가 없다", () => {
  assertEquals(connectionConnect.actors, ["user"]);
  assertEquals(connectionConnect.confirmation, undefined);
  const input = { label: "claude code", scope: allScope };
  assert(connectionConnectInputSchema.safeParse(input).success);
  // token 생성·붙여 넣기·hash field는 입구에 없다.
  for (const extra of ["token", "token_digest", "id"]) {
    assert(
      !connectionConnectInputSchema.safeParse({ ...input, [extra]: "x" })
        .success,
    );
  }
  assert(
    !connectionConnectInputSchema.safeParse({ ...input, label: " " }).success,
  );
  assert(connectionConnectOutputSchema.safeParse({ connection: CAC }).success);
  assert(
    !connectionConnectOutputSchema.safeParse({
      connection: CAC,
      token: "x",
    }).success,
  );
});

Deno.test("coding-agent/connection#R17 platform/identity#R15: child 등록·해제 입구는 사람(신뢰 감독) credential만 부르고 scope·token 필드가 없다", () => {
  for (
    const route of [
      connectionRegisterChild,
      connectionEndChild,
      connectionEndConnection,
    ]
  ) {
    assertEquals(route.kind, "memory");
    assertEquals(route.actors, ["user"]);
  }
  const input = {
    connection: CAC,
    process_generation: "123.456",
    loader_identity: "/opt/lophn/lophn-credential",
  };
  assert(connectionRegisterChildInputSchema.safeParse(input).success);
  // scope·token은 본문으로 받지 않는다(scope는 core가 ledger에서 읽는다).
  for (const extra of ["scope", "token", "token_digest"]) {
    assert(
      !connectionRegisterChildInputSchema.safeParse({ ...input, [extra]: "x" })
        .success,
    );
  }
  assert(
    !connectionRegisterChildInputSchema.safeParse({
      ...input,
      process_generation: "",
    }).success,
  );
});
