import { assert, assertEquals } from "@std/assert";
import { ROLES } from "../../protocol/lophn-agent/places.ts";
import { builtinToolNames } from "../agent-roles/tool-lists.ts";
import { ticketCreate } from "../../protocol/coding-agent/ticket/mod.ts";
import { roleOperations } from "../agent-roles/credentials.ts";
import { agentTools } from "./agent-tools.ts";

// agent credential 상한은 core가 대조하는 route 이름이어야 한다. tool 이름이면 command가 forbidden이다.
Deno.test("App Engineer의 credential 상한에 ticket.create tool이 부르는 route 이름이 든다", () => {
  const operations = roleOperations("app_engineer", agentTools());
  assert(operations.includes(ticketCreate.name));
  assertEquals(ticketCreate.name, "CreateTicket");
  assert(!operations.includes("ticket.create"));
});

// selectTools는 정의 없는 이름을 조용히 건너뛴다. 어긋나면 agent가 그 tool을 말없이 못 본다.
Deno.test("role 목록의 모든 이름에 정의가 있고 모든 정의가 어느 role 목록에 있다", () => {
  const defined = new Set(agentTools().map((tool) => tool.name));
  const listed = new Set(ROLES.flatMap((role) => builtinToolNames(role)));
  assertEquals([...listed].filter((name) => !defined.has(name)), []);
  assertEquals([...defined].filter((name) => !listed.has(name)), []);
});
