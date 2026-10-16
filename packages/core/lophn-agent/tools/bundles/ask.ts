import { ok } from "../../../../base/mod.ts";
import { ASK_TOOL_RULES } from "../../../../protocol/lophn-agent/ask-tool.ts";
import type { ToolInput } from "../domain/input.ts";
import { fitted } from "../domain/result.ts";
import type { ToolDefinition } from "../registry.ts";
import { defineBuiltin } from "./common.ts";

// 질문을 대기 목록에 올리고 풀릴 때까지 기다린다. 기다림은 QuestionWait가 맡는다. 사람이 열지 않은 session에서도 쓴다.
export const ASK_TOOLS: readonly ToolDefinition[] = [
  defineBuiltin({
    name: "ask",
    description:
      `Ask the person 1 to 4 questions, each with a short header, 2 to 4 options (label and one-line description) and multiSelect. The person can always answer in their own words. The turn waits for the answer. ${ASK_TOOL_RULES} ` +
      "The result is outcome submitted (answers in question order), cancelled, or human_message when the person sent a message instead; read that message yourself to see whether it answers.",
    effect: "read",
    handler: async (input, ctx) => {
      const asked = await ctx.questions.ask(
        ctx.session,
        (input as ToolInput<"ask">).questions,
      );
      if (!asked.ok) return asked;
      return ok(fitted(`ask ${asked.value.outcome}`, asked.value));
    },
  }),
];
