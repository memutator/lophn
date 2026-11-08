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
      "Returns submitted, cancelled, human_message or parent_reply (read the message to see whether it answers). Unattended turns return unattended immediately; decide yourself or report what remains. In a team, questions go to your parent.",
    effect: "read",
    // 사람이 없는 turn과 팀 자식의 질문은 core가 가른다(unattended를 돌려주거나 부모에게 보낸다).
    handler: async (input, ctx) => {
      const asked = await ctx.questions.ask(
        { session: ctx.session, turn: ctx.turn, tool_call: ctx.tool_call },
        input.questions,
      );
      if (!asked.ok) return asked;
      return ok(fitted(`ask ${asked.value.outcome}`, asked.value));
    },
  }),
];
