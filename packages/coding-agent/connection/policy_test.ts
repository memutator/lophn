import { assert, assertEquals } from "@std/assert";
import { contractRoutesByName } from "./testing/mod.ts";
import {
  APP_SCOPE_CONCERNS,
  appScopeAllows,
  FORBIDDEN_ACTIONS,
  FORBIDDEN_ROUTES,
  forbiddenRouteNames,
  HUMAN_ONLY_DOCUMENT_ROUTES,
  isForbiddenAction,
  registrationAllowed,
} from "./policy.ts";

Deno.test("coding-agent/connection#R5: app scope allows only that app's documents, app, problems, tickets, and shared formats, SDK, templates", () => {
  for (const concern of APP_SCOPE_CONCERNS) {
    assert(appScopeAllows(concern));
  }
  assertEquals(
    [...APP_SCOPE_CONCERNS],
    ["documents", "app", "problems", "tickets", "formats", "sdk", "templates"],
  );
  assert(!appScopeAllows("projects"));
  assert(!appScopeAllows("secrets"));
  assert(!appScopeAllows("backup"));
});

Deno.test("coding-agent/connection#R7: coding agent cannot decide approvals, change grants, read secrets, or perform the other forbidden actions", () => {
  const expected = [
    "approval.decide",
    "grant.change",
    "secret.read",
    "backup.read",
    "problem.close",
    "problem.ignore",
    "problem.confirm",
    "connection.create",
    "connection.revoke",
    "connection.widen",
    "project.register",
    "project.tracking",
    "context.define",
    "term.define",
    "assignment.change",
    "ticket.goal",
    "ticket.confirm",
    "test_result.write",
  ];
  assertEquals([...FORBIDDEN_ACTIONS], expected);
  for (const action of expected) assert(isForbiddenAction(action));
  assert(!isForbiddenAction("documents.read"));
  assert(!isForbiddenAction("ticket.claim"));
});

Deno.test("coding-agent/connection#R4: app registration is allowed only for scope all", () => {
  assert(registrationAllowed({ kind: "all", app: null }));
  assert(
    !registrationAllowed({
      kind: "app",
      app: "app_01arz3ndektsv4rrffq69g5fav",
    }),
  );
});

Deno.test("coding-agent/mcp-server#R31 coding-agent/cli#R6: 금지 동작마다 route 이름이 있고 계약 표에 실제로 있으며 coding_agent actor를 받는 것은 이름 조회뿐이다", () => {
  const routes = contractRoutesByName();
  // 모든 금지 동작이 표에 있다. route가 없는 동작은 빈 배열로 없는 것이 거절이다.
  assertEquals(
    Object.keys(FORBIDDEN_ROUTES).sort(),
    [...FORBIDDEN_ACTIONS].sort(),
  );
  const names = forbiddenRouteNames();
  for (const name of names) {
    assert(routes.has(name), `계약 route 표에 없는 금지 route: ${name}`);
  }
  assert(HUMAN_ONLY_DOCUMENT_ROUTES.every((name) => names.includes(name)));
  // 계약 actor가 이미 coding_agent를 빼는 route가 대부분이고, 남는 읽기 세 개는
  // 이름·metadata만 낸다. 값은 어느 route에도 없고, coding credential의 operation 목록에
  // 넣지 않는 것이 그 거절이다(daemon 시험이 같은 목록으로 본다).
  const acceptingCodingAgent = names.filter((name) =>
    routes.get(name)!.actors.includes("coding_agent")
  ).sort();
  assertEquals(acceptingCodingAgent, [
    "GetBackup",
    "ListBackups",
    "ListSecrets",
  ]);
  // 사람이 허락하는 route의 actor에 coding_agent가 없다.
  for (
    const name of [
      "grant_approval_request",
      "reject_approval_request",
      "ApplyProblemDecision",
      "CreateCodingAgentConnection",
      "RevokeCodingAgentConnection",
    ]
  ) {
    assertEquals(
      routes.get(name)!.actors.includes("coding_agent"),
      false,
      name,
    );
  }
});
