// 작성 편의형. 검증과 정규화는 정본 validateBlueprint만 쓴다.
// 선언을 더하거나 옛 필드를 바꾸지 않는다.
// 신뢰하지 않는 JSON은 validateBlueprint가 받는다. 작성형은 타입을 유지한다.

import {
  type AgentContextDeclaration,
  type Blueprint,
  type BlueprintOptions,
  type CommandDeclaration,
  type ScreenDeclaration,
  validateBlueprint,
} from "../../protocol/apps/blueprint.ts";

function reject(message: string): never {
  throw new TypeError(message);
}

export function defineBlueprint(
  value: Blueprint,
  options?: BlueprintOptions,
): Blueprint {
  const result = validateBlueprint(value, options);
  if (!result.ok) reject(result.error.message);
  return result.value;
}

// 단독 context schema는 없다. references 전체를 최소 완전 blueprint로 검사한다.
export function defineAgentContext(
  declaration: AgentContextDeclaration,
  references: { screens: ScreenDeclaration[]; commands: CommandDeclaration[] },
): AgentContextDeclaration {
  const result = validateBlueprint({
    name: "agent context",
    description: "agent context declaration",
    screens: references.screens,
    commands: references.commands,
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [declaration],
    app_connections: [],
    sdk_dependencies: [],
  });
  if (!result.ok) reject(result.error.message);
  const context = result.value.agent_context[0];
  if (context === undefined) reject("agent context was not declared");
  return context;
}
