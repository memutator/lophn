import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/route.ts";
import { TICKET_CLAIM_EVENTS, TICKET_CLAIM_ROUTES } from "./ticket-claims.ts";
import {
  getTicket,
  TICKET_OPEN_EVENTS,
  TICKET_OPEN_ROUTES,
  ticketCreate,
  ticketMakeReady,
} from "./ticket-routes.ts";
Deno.test("coding-agent/tickets#R1: route와 event 이름은 architecture 5.3과 make_ready를 포함한다", () => {
  const routes = [...TICKET_OPEN_ROUTES, ...TICKET_CLAIM_ROUTES];
  assertEquals(routes.map((route) => routePath(route)), [
    "/v1/tickets/list",
    "/v1/tickets/show",
    "/v1/tickets/checks",
    "/v1/tickets/create",
    "/v1/tickets/make_ready",
    "/v1/tickets/claim",
    "/v1/tickets/renew_claim",
    "/v1/tickets/release_claim",
    "/v1/tickets/report_completion",
    "/v1/tickets/expire_claim",
    "/v1/tickets/record_checks",
    "/v1/tickets/cancel",
  ]);
  assertEquals(
    [...TICKET_OPEN_EVENTS, ...TICKET_CLAIM_EVENTS].map((event) => event.type),
    [
      "TicketCreated",
      "TicketMadeReady",
      "TicketClaimed",
      "TicketClaimRenewed",
      "TicketClaimReleased",
      "TicketCompletionReported",
      "TicketChecksRecorded",
      "TicketConfirmed",
      "TicketCheckFailed",
      "TicketCancelled",
    ],
  );
  assertEquals(ticketCreate.actors, ["user", "agent"]);
  assertEquals(ticketMakeReady.actors, ["user", "agent"]);
  assertEquals(ticketCreate.confirmation, undefined);
  assertEquals(getTicket, TICKET_OPEN_ROUTES[1]);
  const known = new Set<string>(ERROR_CODES);
  for (const route of routes) {
    for (const code of route.errors) assert(known.has(code));
  }
});
