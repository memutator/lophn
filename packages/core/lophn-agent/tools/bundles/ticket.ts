import { ok } from "../../../../base/mod.ts";
import {
  ticketCancel,
  ticketCreate,
  ticketList,
  ticketShow,
  ticketUpdate,
  ticketVerify,
} from "../../../../protocol/coding-agent/ticket/mod.ts";
import { commandOf, readOf } from "../../run-loop/core-call.ts";
import type { ToolDefinition } from "../registry.ts";
import type { ToolInput } from "../domain/input.ts";
import { countSummary, fitted, invalid, readBody } from "../domain/result.ts";
import { defineTool } from "../define.ts";
import { TOOL_INPUTS } from "../../../../protocol/lophn-agent/tool-catalog.ts";

// ticket은 목표, acceptance check 하나, 근거 링크다. 상태 전이는 route가 지킨다.
export const TICKET_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "ticket.list",
    input: TOOL_INPUTS["ticket.list"],
    routes: [ticketList],
    description:
      "List tickets, optionally of one app or one state. Returns id, app, title and state.",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(
        ctx.core,
        ticketList,
        input as ToolInput<"ticket.list">,
      );
      if (!read.ok) return read;
      const { body, more } = readBody(read.value);
      return ok(fitted(
        countSummary("tickets", body.tickets.length, more),
        body,
        ["tickets"],
      ));
    },
  }),
  defineTool({
    name: "ticket.get",
    input: TOOL_INPUTS["ticket.get"],
    routes: [ticketShow],
    description:
      "Read a ticket: goal, acceptance check, evidence, state, claim, completion report and check result.",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(
        ctx.core,
        ticketShow,
        input as ToolInput<"ticket.get">,
      );
      if (!read.ok) return read;
      const { ticket } = read.value;
      return ok(fitted(`ticket ${ticket.id} is ${ticket.state}`, ticket));
    },
  }),
  defineTool({
    name: "ticket.create",
    input: TOOL_INPUTS["ticket.create"],
    routes: [ticketCreate],
    description:
      "Open a ticket for a coding agent: a goal, one acceptance check (app_test, test_command or text) and optional evidence links (problem, ticket, release, file, annotation).",
    effect: "write",
    handler: async (input, ctx) => {
      const made = await commandOf(
        ctx.core,
        ticketCreate,
        input as ToolInput<"ticket.create">,
        {},
        ctx.tool_call,
      );
      if (!made.ok) return made;
      return ok(fitted(`opened ticket ${made.value.ticket}`, made.value));
    },
  }),
  defineTool({
    name: "ticket.update",
    input: TOOL_INPUTS["ticket.update"],
    routes: [ticketUpdate],
    description:
      "Change the goal or the acceptance check of a ticket before it closes.",
    effect: "write",
    handler: async (input, ctx) => {
      const changed = await commandOf(
        ctx.core,
        ticketUpdate,
        input as ToolInput<"ticket.update">,
        {},
        ctx.tool_call,
      );
      if (!changed.ok) return changed;
      return ok(
        fitted(`updated ticket ${changed.value.ticket}`, changed.value),
      );
    },
  }),
  defineTool({
    name: "ticket.verify",
    input: TOOL_INPUTS["ticket.verify"],
    routes: [ticketShow, ticketVerify],
    description:
      "Mark a reported ticket verified or failed. A verified ticket is activated by the program.",
    effect: "write",
    handler: async (input, ctx) => {
      const { ticket, result, note } = input as ToolInput<"ticket.verify">;
      const read = await readOf(ctx.core, ticketShow, { ticket });
      if (!read.ok) return read;
      const view = read.value.ticket;
      if (view.completion === null) {
        return invalid("the ticket has no completion report");
      }
      const done = await commandOf(
        ctx.core,
        ticketVerify,
        {
          ticket,
          base_revision: view.revision,
          completion_seq: view.completion.completion_seq,
          result,
          ...(note === undefined ? {} : { note }),
        },
        { base_revision: view.revision },
        ctx.tool_call,
      );
      if (!done.ok) return done;
      return ok(fitted(`ticket ${ticket} is ${done.value.state}`, done.value));
    },
  }),
  defineTool({
    name: "ticket.cancel",
    input: TOOL_INPUTS["ticket.cancel"],
    routes: [ticketCancel],
    description: "Cancel a ticket with a one line reason.",
    effect: "write",
    handler: async (input, ctx) => {
      const done = await commandOf(
        ctx.core,
        ticketCancel,
        input as ToolInput<"ticket.cancel">,
        {},
        ctx.tool_call,
      );
      if (!done.ok) return done;
      return ok(fitted(`cancelled ticket ${done.value.ticket}`, done.value));
    },
  }),
];
