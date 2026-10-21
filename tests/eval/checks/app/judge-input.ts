// judge가 받는 입력을 만든다. fixture(core === null)에서도 빈 글이 아닌 글을 돌려준다.
import { appTools } from "../../../../packages/protocol/apps/blueprint/read.ts";
import type { AskInput } from "../../../../packages/protocol/lophn-agent/ask-tool.ts";
import { asksGapInput, joinInput } from "../../judge/mod.ts";
import type { CheckInput } from "../../types.ts";
import { toolCallsOf } from "../records.ts";
import { clip, designOf } from "./design-doc.ts";
import { findApp } from "./live.ts";

// request는 사람 말(`say`)이다.
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

// 앱이 선언한 tool과 연결, App Engineer가 쓴 DESIGN.md 전체를 카드와 견주게 한다.
export function cardCoveredInput(
  card: string,
  app: string,
): (input: CheckInput) => Promise<string> {
  return async (input) => {
    let blueprint = "(not available)";
    if (input.core !== null) {
      const found = await findApp(input.core, app);
      const bp = await input.core.call(appTools, { app: found.id });
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
    }
    const text = await designOf(input, app);
    return joinInput([
      { label: "CARD", text: card },
      { label: "BLUEPRINT", text: clip(blueprint) },
      {
        label: "DESIGN",
        text: text === null ? "(DESIGN.md not found)" : clip(text),
      },
    ]);
  };
}
