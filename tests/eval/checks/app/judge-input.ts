// judge가 받는 입력을 만든다. fixture(core === null)에서도 빈 글이 아닌 글을 돌려준다.
import { appTools } from "../../../../packages/protocol/apps/blueprint/read.ts";
import type { AskInput } from "../../../../packages/protocol/lophn-agent/ask-tool.ts";
import { asksGapInput, joinInput } from "../../judge/mod.ts";
import type { CheckInput, TrialRecord } from "../../types.ts";
import { toolCallsOf } from "../records.ts";
import type { BugSpec } from "./diagnose.ts";
import { findApp } from "./live.ts";
import { appTickets, filesOf, problemTickets } from "./tickets.ts";

const SECTION_MAX = 12_000;

function clip(text: string): string {
  return text.length > SECTION_MAX
    ? `${text.slice(0, SECTION_MAX)}\n[truncated]`
    : text;
}

type TicketText = { goal: string; check: unknown; state?: string };

const ticketLines = (tickets: TicketText[]) =>
  tickets.map((t, i) =>
    [
      `TICKET ${i + 1}${t.state === undefined ? "" : ` [${t.state}]`}`,
      `goal: ${t.goal}`,
      `check: ${JSON.stringify(t.check)}`,
    ].join("\n")
  ).join("\n\n");

// 기록의 ticket.create tool call 입력. fixture에서 ticket 대신 쓴다.
function createdTickets(trial: TrialRecord) {
  return toolCallsOf(trial, "ticket.create").flatMap((c) => {
    const input = c.input as
      | {
        goal?: string;
        check?: unknown;
        evidence?: { kind: string; path?: string }[];
      }
      | null;
    return typeof input?.goal === "string"
      ? [{
        goal: input.goal,
        check: input.check ?? null,
        files: (input.evidence ?? []).flatMap((e) =>
          e.kind === "file" && e.path !== undefined ? [e.path] : []
        ),
      }]
      : [];
  });
}

export function cardCoveredInput(
  card: string,
  app: string,
): (input: CheckInput) => Promise<string> {
  return async ({ trial, core }) => {
    let blueprint = "(not available)";
    let tickets: string;
    if (core === null) {
      tickets = ticketLines(createdTickets(trial));
    } else {
      const found = await findApp(core, app);
      const bp = await core.call(appTools, { app: found.id });
      blueprint = [
        ...bp.tools.map((a) =>
          `- ${a.name} (${a.effect}): ${a.description} input=${
            JSON.stringify(a.inputSchema)
          }`
        ),
        ...bp.declarations.app_connections.map((c) =>
          `connection: ${c.app} -> ${c.tools.join(", ")}`
        ),
      ].join("\n");
      tickets = ticketLines(
        (await appTickets(core, found.id)).map((t) => ({
          goal: t.goal,
          check: t.check,
          state: t.state,
        })),
      );
    }
    return joinInput([
      { label: "CARD", text: card },
      { label: "BLUEPRINT", text: clip(blueprint) },
      { label: "TICKETS", text: clip(tickets || "(none)") },
    ]);
  };
}

// request는 사람 말(`say`)이나 `deliver`한 call 본문이다. lophn session이 보낸 call에는 없다.
export function askedAgainInput(
  request: string,
): (input: CheckInput) => string {
  return ({ trial }) => {
    const questions = toolCallsOf(trial, "ask").flatMap((c) =>
      (c.input as { questions?: AskInput["questions"] } | null)?.questions ??
        []
    );
    return asksGapInput(request, questions);
  };
}

export function rootCauseInput(
  bug: BugSpec,
  app: string,
): (input: CheckInput) => Promise<string> {
  return async ({ trial, core }) => {
    let goals: string[];
    let files: string[];
    if (core === null) {
      const created = createdTickets(trial);
      goals = created.map((t) => t.goal);
      files = created.flatMap((t) => t.files);
    } else {
      const found = await findApp(core, app);
      const tickets = await problemTickets(core, found.id);
      goals = tickets.map((t) => t.goal);
      files = tickets.flatMap(filesOf);
    }
    return joinInput([
      {
        label: "BUG",
        text: `${bug.description}\nfiles: ${bug.files.join(", ")}`,
      },
      {
        label: "TICKET_GOALS",
        text: goals.map((g, i) => `${i + 1}. ${g}`).join("\n") || "(none)",
      },
      { label: "EVIDENCE_FILES", text: files.join("\n") || "(none)" },
    ]);
  };
}
