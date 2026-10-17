import { assert, assertEquals } from "@std/assert";
import { ticketCreate } from "../../protocol/coding-agent/ticket/mod.ts";
import { roleOperations } from "../lophn-agent/run-loop/mod.ts";
import { agentTools } from "./agent-tools.ts";

// agent credential 상한은 core가 대조하는 route 이름이어야 한다. tool 이름이면 command가 forbidden이다.
Deno.test("App Engineer의 credential 상한에 ticket.create tool이 부르는 route 이름이 든다", () => {
  const operations = roleOperations("app_engineer", agentTools());
  assert(operations.includes(ticketCreate.name));
  assertEquals(ticketCreate.name, "CreateTicket");
  assert(!operations.includes("ticket.create"));
});
