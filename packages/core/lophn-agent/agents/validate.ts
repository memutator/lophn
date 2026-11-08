import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentDefinition,
  type AgentDefinitionIssue,
  type AgentId,
  agentHandleKey,
  LOPHN_AGENT_ID,
  MCP_TOOL_PREFIX,
  NEW_AGENT_HANDLE,
  parseExtensionToolName,
  WORKSPACE_KINDS,
  workspaceToolNames,
} from "../../../protocol/lophn-agent/mod.ts";
import { COMMANDS } from "../../../cli/commands/mod.ts";
import { isBuiltinWord } from "../tools/lophn/resolve.ts";
import { serializeAgentFile } from "./definition-file.ts";
import {
  type AgentContext,
  issuesOfError,
  handleOf,
  listAgents,
} from "./inspect.ts";

// 저장 때의 전체 검사. 파일 모양 검사에 파일만으로 알 수 없는 handle 중복을 더한다.

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

// handle은 범위 있는 agent까지 전역에 하나다. 틀린 file은 handle을 알 수 없어 겹침에 넣지 않는다.
function duplicateHandle(
  context: AgentContext,
  self: AgentId,
  handle: string,
): Result<boolean> {
  const others = listAgents(context);
  if (!others.ok) return others;
  const key = agentHandleKey(handle);
  return ok(
    others.value.some(
      (other) =>
        other.agent !== self &&
        other.issues.length === 0 &&
        agentHandleKey(handleOf(other)) === key,
    ),
  );
}

const BUILTIN_TOOLS = new Set(WORKSPACE_KINDS.flatMap(workspaceToolNames));
const COMMAND_NAMES = new Set(COMMANDS.map((command) => command.name));
const APP_COMMAND = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.\S+$/;

// bare가 고른 이름이 내장 tool, lophn 명령, 앱 command(`<slug>.<command>`), MCP tool, extension tool(`ext__<id>__<tool>`) 중 하나인가. workspace 종류, 할당, 설정한 server는
// 나중에 바뀌므로 보지 않는다. 앱 slug는 내장 명령 묶음의 첫 낱말과 겹칠 수 없어(RESERVED_APP_SLUGS), 첫 낱말이 명령 묶음이면
// 앱 command일 수 없고 명령 표에 있는 이름이어야 한다(`call.replay`를 잡는다).
function knownToolName(name: string): boolean {
  if (BUILTIN_TOOLS.has(name) || COMMAND_NAMES.has(name)) return true;
  if (parseExtensionToolName(name) !== null) return true;
  if (name.startsWith(MCP_TOOL_PREFIX)) {
    return name.slice(MCP_TOOL_PREFIX.length).includes("__");
  }
  return APP_COMMAND.test(name) && !isBuiltinWord(name.split(".")[0]);
}

// 맞으면 파일에 쓸 글을 돌려준다. 새로 만들 때(`creating`)만 handle의 모양과 범위 workspace가 있는지 본다:
// 옛 정의의 handle은 name을 옮긴 것이라 모양이 다를 수 있다.
export function checkAgent(input: {
  context: AgentContext;
  agent: AgentId;
  definition: AgentDefinition;
  creating: boolean;
}): Result<string> {
  const { context, agent, definition, creating } = input;
  const issues: AgentDefinitionIssue[] = [];
  const text = serializeAgentFile(definition, { agent });
  if (!text.ok) addAll(issues, issuesOfError(text.error));

  definition.tools?.forEach((name, index) => {
    if (!knownToolName(name))
      addAll(issues, [{ field: `tools.${index}`, code: "unknown" }]);
  });

  if (!issues.some((issue) => issue.field === "handle")) {
    const taken = duplicateHandle(context, agent, definition.handle);
    if (!taken.ok) return taken;
    if (taken.value) addAll(issues, [{ field: "handle", code: "duplicate" }]);
  }
  if (creating && agent !== LOPHN_AGENT_ID) {
    if (
      !issues.some((issue) => issue.field === "handle") &&
      !NEW_AGENT_HANDLE.test(definition.handle)
    ) {
      addAll(issues, [{ field: "handle", code: "invalid_value" }]);
    }
    if (
      definition.workspace !== undefined &&
      !context.lookups.workspaceExists(definition.workspace)
    ) {
      addAll(issues, [{ field: "workspace", code: "invalid_value" }]);
    }
  }

  if (issues.length > 0 || !text.ok) return invalidInput(issues);
  return ok(text.value);
}
