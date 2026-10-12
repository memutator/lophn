import { err, ok, type Result } from "../../base/mod.ts";
import {
  type AgentDefinition,
  type AgentIssue,
  agentNameKey,
  agentPlaceAllowsRole,
  type AgentRole,
  type AgentSettings,
} from "../../protocol/lophn-agent/mod.ts";
import { parseAgentFile, serializeAgentFile } from "./definition-file.ts";
import { callableIn, issuesOfError, type PlaceView } from "./inspect.ts";
import { permissionIssues } from "./resolve.ts";

// 저장 때의 전체 검사(R24). 파일 모양 검사에 파일만으로 알 수 없는 것을 더한다: 같은 자리 Operator 사이의
// 이름 중복, context 참조, 권한 상한. 틀린 칸은 하나도 빠뜨리지 않고 모아 한 번에 알린다.

export function invalidInput(issues: AgentIssue[]): Result<never> {
  return err({
    code: "invalid_input",
    message: "agent is invalid",
    details: { issues },
  });
}

function addAll(into: AgentIssue[], more: readonly AgentIssue[]) {
  for (const issue of more) {
    if (!into.some((i) => i.field === issue.field && i.code === issue.code)) {
      into.push(issue);
    }
  }
}

function duplicateName(
  view: PlaceView,
  assignment: string | null,
  name: string,
): Result<boolean> {
  const { place, context } = view;
  const key = agentNameKey(name);
  for (const ref of context.lookups.assignments(place)) {
    if (ref.role !== "operator" || ref.id === assignment) continue;
    if (!callableIn(ref, place)) continue;
    const file = context.store.read(place, `${ref.id}.md`);
    if (!file.ok) return file;
    if (file.value === null) continue;
    const parsed = parseAgentFile(file.value.text, {
      role: "operator",
      place: place.kind,
    });
    // 틀린 파일은 이름을 알 수 없어 다른 이름과 겹쳤다고 하지 않는다.
    if (parsed.ok && parsed.value.name !== undefined) {
      if (agentNameKey(parsed.value.name) === key) return ok(true);
    }
  }
  return ok(false);
}

// 정의 ⊆ 자리 ⊆ Workspace 기본이고 정의 ⊆ RoleCaps다(R20, R21). 층에 권한 칸이 없으면 거르지 않는다.
function capIssues(
  tools: readonly string[],
  layers: readonly (readonly string[] | undefined)[],
): AgentIssue[] {
  const found: AgentIssue[] = [];
  for (const allowed of layers) {
    if (allowed !== undefined) addAll(found, permissionIssues(tools, allowed));
  }
  return found;
}

// 맞으면 파일에 쓸 글을 돌려준다.
export function checkSave(input: {
  view: PlaceView;
  role: AgentRole;
  assignment: string | null;
  definition: AgentDefinition;
}): Result<string> {
  const { view, role, assignment, definition } = input;
  const { place } = view;
  const issues: AgentIssue[] = [];

  const text = serializeAgentFile(definition, { role, place: place.kind });
  if (!text.ok) addAll(issues, issuesOfError(text.error));
  if (!agentPlaceAllowsRole(role, place)) {
    addAll(issues, [{ field: "place", code: "not_allowed" }]);
  }

  if (role === "operator") {
    if (definition.name !== undefined && definition.name.trim() !== "") {
      const taken = duplicateName(view, assignment, definition.name);
      if (!taken.ok) return taken;
      if (taken.value) addAll(issues, [{ field: "name", code: "duplicate" }]);
    }
    if (place.kind === "project") {
      // 없는 context와 다른 project의 context는 `missing_reference`, 보관한 context는
      // `archived_reference`로 고를 수 없다. 만드는 중인 context는 고를 수 있다. 저장한 뒤 보관된
      // context는 정의에 그대로 두고 실행 때만 자료에서 뺀다(resolve).
      (definition.contexts ?? []).forEach((id, index) => {
        const lookups = view.context.lookups;
        const status = lookups.contextStatus(id);
        const code = status === null || lookups.contextProject(id) !== place.id
          ? "missing_reference"
          : status === "archived"
          ? "archived_reference"
          : null;
        if (code !== null) {
          addAll(issues, [{ field: `contexts.${index}`, code }]);
        }
      });
    }
  }

  if (definition.permissions !== undefined) {
    addAll(
      issues,
      capIssues(definition.permissions.tools, [
        view.deps.roleCaps(role),
        view.settings.settings.permissions?.tools,
        view.workspace.permissions?.tools,
      ]),
    );
  }

  if (issues.length > 0 || !text.ok) return invalidInput(issues);
  return ok(text.value);
}

// 자리 설정의 권한은 Workspace 기본의 부분집합이어야 한다(R10, R21).
export function checkSettings(input: {
  settings: AgentSettings;
  workspace: AgentSettings;
  text: Result<string>;
}): Result<string> {
  const issues: AgentIssue[] = [];
  if (!input.text.ok) addAll(issues, issuesOfError(input.text.error));
  const tools = input.settings.permissions?.tools;
  const allowed = input.workspace.permissions?.tools;
  if (tools !== undefined && allowed !== undefined) {
    addAll(issues, permissionIssues(tools, allowed));
  }
  if (issues.length > 0 || !input.text.ok) return invalidInput(issues);
  return ok(input.text.value);
}
