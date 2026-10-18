import {
  problemList,
  type ProblemListItem,
} from "../../../../packages/protocol/problems/mod.ts";
import {
  ticketList,
  ticketShow,
} from "../../../../packages/protocol/coding-agent/ticket/mod.ts";
import type { App } from "../../../../packages/protocol/apps/mod.ts";
import type { Core } from "../../../support/core/mod.ts";

export type TicketView = Awaited<
  ReturnType<typeof showTicket>
>;

async function showTicket(core: Core, ticket: string) {
  return (await core.call(ticketShow, { ticket: ticket as never })).ticket;
}

export async function appTickets(
  core: Core,
  app: App["id"],
): Promise<TicketView[]> {
  const { tickets } = await core.call(ticketList, { app });
  return await Promise.all(tickets.map((t) => showTicket(core, t.id)));
}

export async function appProblems(
  core: Core,
  app: App["id"],
): Promise<ProblemListItem[]> {
  return (await core.call(problemList, { app })).problems;
}

// 앱의 problem 가운데 하나를 근거로 붙인 ticket.
export async function problemTickets(
  core: Core,
  app: App["id"],
): Promise<TicketView[]> {
  const ids = new Set((await appProblems(core, app)).map((p) => p.id));
  return (await appTickets(core, app)).filter((t) =>
    t.evidence.some((e) => e.kind === "problem" && ids.has(e.id))
  );
}

export function filesOf(ticket: TicketView): string[] {
  return ticket.evidence.flatMap((e) => e.kind === "file" ? [e.path] : []);
}
