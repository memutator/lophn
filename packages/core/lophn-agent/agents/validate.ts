import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentDefinition,
  type AgentDefinitionIssue,
  type AgentId,
  agentNameKey,
  MCP_TOOL_PREFIX,
  WORKSPACE_KINDS,
  workspaceToolNames,
} from "../../../protocol/lophn-agent/mod.ts";
import { COMMANDS } from "../../../cli/commands/mod.ts";
import { isBuiltinWord } from "../tools/lophn/resolve.ts";
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

const BUILTIN_TOOLS = new Set(WORKSPACE_KINDS.flatMap(workspaceToolNames));
const COMMAND_NAMES = new Set(COMMANDS.map((command) => command.name));
const APP_COMMAND = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.\S+$/;

// bare가 고른 이름이 내장 tool, lophn 명령, 앱 command(`<slug>.<command>`), MCP tool 중 하나인가. workspace 종류, 할당, 설정한 server는
// 나중에 바뀌므로 보지 않는다. 앱 slug는 내장 명령 묶음의 첫 낱말과 겹칠 수 없어(RESERVED_APP_SLUGS), 첫 낱말이 명령 묶음이면
// 앱 command일 수 없고 명령 표에 있는 이름이어야 한다(`call.replay`를 잡는다).
function knownToolName(name: string): boolean {
  if (BUILTIN_TOOLS.has(name) || COMMAND_NAMES.has(name)) return true;
  if (name.startsWith(MCP_TOOL_PREFIX)) {
    return name.slice(MCP_TOOL_PREFIX.length).includes("__");
  }
  return APP_COMMAND.test(name) && !isBuiltinWord(name.split(".")[0]);
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

  definition.tools?.forEach((name, index) => {
    if (!knownToolName(name))
      addAll(issues, [{ field: `tools.${index}`, code: "unknown" }]);
  });

  if (!issues.some((issue) => issue.field === "name")) {
    const taken = duplicateName(context, agent, definition.name);
    if (!taken.ok) return taken;
    if (taken.value) addAll(issues, [{ field: "name", code: "duplicate" }]);
  }

  if (issues.length > 0 || !text.ok) return invalidInput(issues);
  return ok(text.value);
}
