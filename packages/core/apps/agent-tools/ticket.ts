import { ok } from "../../../base/mod.ts";
import {
  ticketCancel,
  ticketCancelInputSchema,
  ticketCreate,
  ticketCreateInputSchema,
  ticketList,
  ticketShow,
  ticketShowInputSchema,
  ticketStateSchema,
  ticketUpdate,
  ticketUpdateInputSchema,
  ticketVerify,
  ticketVerifyInputSchema,
} from "../../../protocol/coding-agent/ticket/mod.ts";
import {
  commandOf,
  countSummary,
  defineTool,
  fitted,
  invalid,
  readBody,
  readOf,
  type ToolDefinition,
} from "../../lophn-agent/tools/spi.ts";
import { z } from "zod";
import { idSchema } from "../../../protocol/base/ids.ts";

// ticket은 목표, acceptance check 하나, 근거 링크다. 상태 전이는 route가 지킨다.
export const TICKET_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "ticket.list",
    input: z.strictObject({
      app: idSchema("app").optional(),
      state: ticketStateSchema.optional(),
    }),
    routes: [ticketList],
    description:
      "List tickets, optionally of one app or one state. Returns id, app, title and state.",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(
        ctx.core,
        ticketList,
        input,
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
    input: ticketShowInputSchema,
    routes: [ticketShow],
    description:
      "Read a ticket: goal, acceptance check, evidence, state, claim, completion report and check result.",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(
        ctx.core,
        ticketShow,
        input,
      );
      if (!read.ok) return read;
      const { ticket } = read.value;
      return ok(fitted(`ticket ${ticket.id} is ${ticket.state}`, ticket));
    },
  }),
  defineTool({
    name: "ticket.create",
    input: ticketCreateInputSchema,
    routes: [ticketCreate],
    description:
      "Open a ticket for a coding agent: a goal, one acceptance check: app_test (the platform checks), examples (tool calls with their expected results, which the program runs on the reported release) or text (judged by you), and optional evidence links (problem, ticket, release, file, annotation).",
    effect: "write",
    handler: async (input, ctx) => {
      const made = await commandOf(
        ctx.core,
        ticketCreate,
        input,
        {},
        ctx.tool_call,
      );
      if (!made.ok) return made;
      return ok(fitted(`opened ticket ${made.value.ticket}`, made.value));
    },
  }),
  defineTool({
    name: "ticket.update",
    input: ticketUpdateInputSchema,
    routes: [ticketUpdate],
    description:
      "Change the goal or the acceptance check of a ticket before it closes.",
    effect: "write",
    handler: async (input, ctx) => {
      const changed = await commandOf(
        ctx.core,
        ticketUpdate,
        input,
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
    input: ticketVerifyInputSchema.pick({
      ticket: true,
      result: true,
      note: true,
    }),
    routes: [ticketShow, ticketVerify],
    description:
      "Mark a reported ticket verified or failed. A verified ticket is activated by the program. A ticket whose check is examples can be verified only after its examples passed.",
    effect: "write",
    handler: async (input, ctx) => {
      const { ticket, result, note } = input;
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
    input: ticketCancelInputSchema,
    routes: [ticketCancel],
    description: "Cancel a ticket with a one line reason.",
    effect: "write",
    handler: async (input, ctx) => {
      const done = await commandOf(
        ctx.core,
        ticketCancel,
        input,
        {},
        ctx.tool_call,
      );
      if (!done.ok) return done;
      return ok(fitted(`cancelled ticket ${done.value.ticket}`, done.value));
    },
  }),
];
