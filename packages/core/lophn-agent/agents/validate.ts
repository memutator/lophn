import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentDefinition,
  type AgentDefinitionIssue,
  type AgentId,
  agentNameKey,
} from "../../../protocol/lophn-agent/mod.ts";
import { serializeAgentFile } from "./definition-file.ts";
import {
  type AgentContext,
  issuesOfError,
  listAgents,
  nameOf,
} from "./inspect.ts";

// 저장 때의 전체 검사. 파일 모양 검사에 파일만으로 알 수 없는 이름 중복을 더한다.

function invalidInput(issues: AgentDefinitionIssue[]): Result<never> {
  return err({
    code: "invalid_input",
    message: "agent is invalid",
    details: { issues },
  });
}

function addAll(
  into: AgentDefinitionIssue[],
  more: readonly AgentDefinitionIssue[],
) {
  for (const issue of more) {
    if (!into.some((i) => i.field === issue.field && i.code === issue.code)) {
      into.push(issue);
    }
  }
}

// 이름은 전역이다. 틀린 file은 이름을 알 수 없어 겹침에 넣지 않는다.
function duplicateName(
  context: AgentContext,
  self: AgentId,
  name: string,
): Result<boolean> {
  const others = listAgents(context);
  if (!others.ok) return others;
  const key = agentNameKey(name);
  return ok(
    others.value.some(
      (other) =>
        other.agent !== self &&
        other.issues.length === 0 &&
        agentNameKey(nameOf(other)) === key,
    ),
  );
}

// 맞으면 파일에 쓸 글을 돌려준다.
export function checkAgent(input: {
  context: AgentContext;
  agent: AgentId;
  definition: AgentDefinition;
}): Result<string> {
  const { context, agent, definition } = input;
  const issues: AgentDefinitionIssue[] = [];
  const text = serializeAgentFile(definition, { agent });
  if (!text.ok) addAll(issues, issuesOfError(text.error));

  if (!issues.some((issue) => issue.field === "name")) {
    const taken = duplicateName(context, agent, definition.name);
    if (!taken.ok) return taken;
    if (taken.value) addAll(issues, [{ field: "name", code: "duplicate" }]);
  }

  if (issues.length > 0 || !text.ok) return invalidInput(issues);
  return ok(text.value);
}
