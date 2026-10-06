// 고정 blueprint에서 현재 release의 선언 사실을 만든다. permissions의 `currentDeclarations` port가
// 읽는 값이고 준비 때 한 번 계산해 release 행에 둔다(permissions는 blueprint를 해석하지 않는다).
import { createHash } from "node:crypto";
import type { Blueprint } from "../blueprint/mod.ts";
import { canonicalJson, validateInput } from "../blueprint/mod.ts";
import type { GrantPermissionRequirement } from "../../contracts/apps/mod.ts";
import type {
  AppDeclarations,
  AutomationDeclarationFact,
} from "../permissions/mod.ts";

// 정규 입력(default를 채운)의 sha256이다. `canonicalInputHash`(async)와 같은 값이고 core의 동기
// command가 쓰므로 node:crypto로 계산한다. 입력이 없으면 정규 JSON null을 hash한다.
export function canonicalInputHashSync(
  schema: Blueprint["commands"][number]["input"],
  value?: unknown,
): string | undefined {
  const validated = validateInput(schema, value);
  if (!validated.ok) return undefined;
  return createHash("sha256").update(
    canonicalJson(validated.value === undefined ? null : validated.value),
  ).digest("hex");
}

export function declarationsOfBlueprint(
  release: string,
  blueprint: Blueprint,
): AppDeclarations | undefined {
  const automations: AutomationDeclarationFact[] = [];
  for (const task of blueprint.automatic_tasks) {
    const command = blueprint.commands.find((entry) =>
      entry.key === task.command
    );
    if (command === undefined) return undefined;
    const inputHash = canonicalInputHashSync(command.input, task.input);
    if (inputHash === undefined) return undefined;
    automations.push({
      key: task.key,
      command: task.command,
      external: command.effect === "external",
      input_hash: inputHash,
      when: task.when,
    });
  }
  return {
    release,
    permissions: blueprint
      .permissions as unknown as readonly GrantPermissionRequirement[],
    app_connections: blueprint.app_connections.map((use) => ({
      app: use.app,
      commands: [...use.commands],
    })),
    commands: blueprint.commands.map((command) => command.key),
    automations,
    problem_codes: blueprint.problem_codes.map((entry) => entry.code),
    documents: blueprint.documents.map((entry) => ({ ...entry })),
  };
}

// 요구 permission의 비교 이름이다. 같은 요구는 같은 이름이다.
export function permissionLabel(
  requirement: Blueprint["permissions"][number],
): string {
  const scope = requirement.scope as Record<string, unknown>;
  if ("path" in scope) {
    return `${requirement.kind}:${String(scope.path)}${
      scope.recursive === true ? "/**" : ""
    }`;
  }
  if ("host" in scope) {
    return `${requirement.kind}:${String(scope.host)}:${String(scope.port)}`;
  }
  if ("name" in scope) return `${requirement.kind}:${String(scope.name)}`;
  return `${requirement.kind}:${String(scope.key)}`;
}
