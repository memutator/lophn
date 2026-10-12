import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import {
  agentKindOf,
  agentPlaceAllowsRole,
  type AgentRole,
  type AgentSettings,
  BUILTIN_AGENT_NAMES,
  type McpTool,
  type ModelChoice,
  type Profile,
  type ValueSource,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ResolveInput } from "./resolve.ts";

// 읽기용 동기 합치기. ListAgents·ReadAgent는 reader의 동기 handler라 async인 resolveAgent를 기다릴 수 없어,
// 사람이 화면에서 보는 칸(이름·profile·model·tools·skills·mcp·contexts)만 같은 규칙으로 동기로 합친다.
// 규칙은 resolveAgent와 같고 effective_test.ts가 모든 층 조합에서 같은 값을 내는지 본다.
// resolveAgent와 다른 점은 어느 층에도 model이 없어도 실패하지 않고 model을 비운다는 것뿐이다.

export type Effective = {
  name: string;
  profile: Profile;
  model: ModelChoice | null;
  tools: string[];
  skills: string[];
  mcp: McpTool[];
  contexts: string[];
  sources: {
    name: ValueSource;
    profile: ValueSource;
    model: ValueSource | null;
    tools: ValueSource;
  };
};

type BuiltinRole = Exclude<AgentRole, "operator">;

export function effectiveAgent(
  input: ResolveInput,
): Result<Effective, LophnError> {
  const { role, place, definition, environment } = input;
  const operator = agentKindOf(role) === "operator";

  if (!agentPlaceAllowsRole(role, place)) {
    return invalid("place", "not_allowed");
  }
  if (operator && definition === null) {
    return err({ code: "not_found", message: "operator definition not found" });
  }
  const given = operator ? definition?.name : undefined;
  if (operator && (given === undefined || given.trim().length === 0)) {
    return invalid("name", "required");
  }

  const fromDefinition: ValueSource = { layer: "definition", place };
  const fromPlace: ValueSource = { layer: "place", place };
  const fromDefault: ValueSource = { layer: "default", place: null };
  const fromWorkspace: ValueSource = { layer: "workspace", place: null };

  const modelLayers: [ModelChoice | undefined, ValueSource][] = [
    [input.session_model ?? undefined, { layer: "session", place: null }],
    [definition?.model, fromDefinition],
    [input.place_settings.models?.[role], fromPlace],
    [input.workspace.models?.[role], fromWorkspace],
  ];
  const chosen = modelLayers.find(([choice]) => choice !== undefined);

  const permissionLayers: [AgentSettings["permissions"], ValueSource][] = [
    [definition?.permissions, fromDefinition],
    [input.place_settings.permissions, fromPlace],
    [input.workspace.permissions, fromWorkspace],
  ];
  let tools = [...environment.role_caps];
  for (const [permissions] of permissionLayers) {
    if (permissions === undefined) continue;
    const allowed = new Set(permissions.tools);
    tools = tools.filter((tool) => allowed.has(tool));
  }
  const toolsSource =
    permissionLayers.find(([permissions]) => permissions !== undefined)?.[1] ??
      fromDefault;

  const skillsOff = definition?.skills_off ?? [];
  const mcpOff = definition?.mcp_off ?? [];
  const mcp = environment.mcp.filter((tool) =>
    !mcpOff.some((off) =>
      off.server_name === tool.server_name &&
      (off.original_tool === undefined ||
        off.original_tool === tool.original_tool)
    )
  );

  let contexts: string[] = [];
  if (operator) {
    if (place.kind === "project") {
      const active = new Set(environment.active_contexts);
      contexts = (definition?.contexts ?? []).filter((id) => active.has(id));
    }
  } else if (place.kind === "project" || role === "app_engineer") {
    contexts = [...environment.active_contexts];
  }

  return ok(structuredClone({
    name: operator ? given as string : BUILTIN_AGENT_NAMES[role as BuiltinRole],
    profile: definition?.profile ?? environment.default_profile,
    model: chosen === undefined ? null : chosen[0] as ModelChoice,
    tools,
    skills: environment.skills.filter((name) => !skillsOff.includes(name)),
    mcp,
    contexts,
    sources: {
      name: operator ? fromDefinition : fromDefault,
      profile: definition?.profile === undefined ? fromDefault : fromDefinition,
      model: chosen === undefined ? null : chosen[1],
      tools: toolsSource,
    },
  }));
}

function invalid(field: string, code: string): Result<never, LophnError> {
  return err({
    code: "invalid_input",
    message: "agent cannot be resolved",
    details: { issues: [{ field, code }] },
  });
}
