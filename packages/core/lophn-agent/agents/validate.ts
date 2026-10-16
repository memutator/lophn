import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentDefinitionIssue,
  agentNameKey,
  type BuiltinDefinition,
  type OperatorDefinition,
  type Place,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";
import { serializeAgentFile } from "./definition-file.ts";
import {
  type AgentContext,
  issuesOfError,
  listOperators,
  nameOf,
} from "./inspect.ts";

// 저장 때의 전체 검사. 파일 모양 검사에 파일만으로 알 수 없는 것을 더한다: 같은 place Operator 사이의
// 이름 중복과 context 참조. 틀린 칸은 하나도 빠뜨리지 않고 모아 한 번에 알린다.

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

// 이 place의 다른 Operator가 같은 이름을 쓰는가. 틀린 파일은 이름을 알 수 없어 겹쳤다고 하지 않는다.
function duplicateName(
  context: AgentContext,
  place: Place,
  self: string | null,
  name: string,
): Result<boolean> {
  const others = listOperators(context, place);
  if (!others.ok) return others;
  const key = agentNameKey(name);
  return ok(
    others.value.some((other) =>
      (other.ref as { agent: string }).agent !== self &&
      other.definition !== null && agentNameKey(nameOf(other)) === key
    ),
  );
}

// 맞으면 파일에 쓸 글을 돌려준다.
export function checkOperator(input: {
  context: AgentContext;
  place: Place;
  id: string | null;
  definition: OperatorDefinition;
}): Result<string> {
  const { context, place, id, definition } = input;
  const issues: AgentDefinitionIssue[] = [];

  const text = serializeAgentFile(definition, {
    role: "operator",
    place: place.kind,
  });
  if (!text.ok) addAll(issues, issuesOfError(text.error));

  if (definition.name.trim() !== "") {
    const taken = duplicateName(context, place, id, definition.name);
    if (!taken.ok) return taken;
    if (taken.value) addAll(issues, [{ field: "name", code: "duplicate" }]);
  }
  if (place.kind === "project") {
    // 없는 context와 다른 project의 context는 `missing_reference`, 보관한 context는 `archived_reference`로
    // 고를 수 없다. 만드는 중인 context는 고를 수 있다. 저장한 뒤 보관된 context는 정의에 그대로 두고 실행
    // 때만 자료에서 뺀다(resolve).
    const { lookups } = context;
    (definition.contexts ?? []).forEach((contextId, index) => {
      const status = lookups.contextStatus(contextId);
      const code =
        status === null || lookups.contextProject(contextId) !== place.id
          ? "missing_reference"
          : status === "archived"
          ? "archived_reference"
          : null;
      if (code !== null) {
        addAll(issues, [{ field: `contexts.${index}`, code }]);
      }
    });
  }

  if (issues.length > 0 || !text.ok) return invalidInput(issues);
  return ok(text.value);
}

export function checkBuiltin(
  role: Exclude<Role, "operator">,
  definition: BuiltinDefinition,
): Result<string> {
  const text = serializeAgentFile(definition, { role, place: null });
  return text.ok ? ok(text.value) : invalidInput(issuesOfError(text.error));
}
