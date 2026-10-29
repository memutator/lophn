import { ok } from "../../../../base/mod.ts";
import { ASK_TOOL_RULES } from "../../../../protocol/lophn-agent/ask-tool.ts";
import { defineTool, fitted, type ToolDefinition } from "../spi.ts";
import { askInputSchema } from "../../../../protocol/lophn-agent/ask-tool.ts";

// 질문을 대기 목록에 올리고 풀릴 때까지 기다린다. 기다림은 QuestionWait가 맡는다. 사람이 열지 않은 session에서도 쓴다.
export const ASK_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "ask",
    input: askInputSchema,
    routes: [],
    description:
      `Ask the person and wait for answers; free-text answers are always allowed. Each question needs a short header and options with one-line descriptions. ${ASK_TOOL_RULES} ` +
      "Returns submitted, cancelled, or human_message (read it to see whether it answers). Unattended turns return unattended immediately; decide yourself or report what remains.",
    effect: "read",
    handler: async (input, ctx) => {
      // skip turn은 사람이 곁에 있으므로 기다린다. 사람이 없는 turn만 묻지 않는다.
      if (ctx.mode === "unattended") {
        return ok(
          fitted("ask unattended: no person is present in this turn", {
            outcome: "unattended" as const,
          }),
        );
      }
      const asked = await ctx.questions.ask(
        { session: ctx.session, turn: ctx.turn, tool_call: ctx.tool_call },
        input.questions,
      );
      if (!asked.ok) return asked;
      return ok(fitted(`ask ${asked.value.outcome}`, asked.value));
    },
  }),
];
