// 의존성 없는 선언 정본.
// Zod·node·npm·IO·앱 코드 실행이 없다.
// no-input hash의 정규 JSON null은 tool·schema·release 결합을 대신하지 않는다.

import {
  APP_ID,
  type AppDeclaration,
  type CommandDeclaration,
  asJson,
  DECLARATION_KEYS,
  DECLARATION_REQUIRED_KEYS,
  type DeclarationOptions,
  exactKeys,
  invalid,
  isObject,
  type JsonValue,
  nonBlank,
  type PermissionKind,
  type PermissionRequirement,
  singleLine,
  type SkillDeclaration,
  type ValidationResult,
} from "./types.ts";
import { normalizeJson, sortBy, unique } from "./json.ts";
import { validateLayers } from "./tools.ts";
import { validateUses } from "./uses.ts";
import { iconPath, permissionScope, scopeKey } from "./scope.ts";

// skillNameSchema(protocol/lophn-agent/skill-settings.ts)와 같은 규칙이다. 이 file은 의존성이 없어 따로 쓴다.
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function validateSkills(
  items: unknown,
  commands: readonly CommandDeclaration[],
): ValidationResult<SkillDeclaration[]> {
  if (items === undefined) return { ok: true, value: [] };
  if (!Array.isArray(items)) return invalid("skills must be an array");
  const byName = new Map(commands.map((command) => [command.name, command]));
  const skills: SkillDeclaration[] = [];
  for (const item of items) {
    if (!isObject(item)) return invalid("skill must be an object");
    const bad = exactKeys(
      item,
      ["commands", "name", "public"],
      ["commands", "name", "public"],
    );
    if (bad) return invalid(`skill ${bad}`);
    if (
      typeof item.name !== "string" ||
      item.name.length > 64 ||
      !SKILL_NAME.test(item.name)
    ) {
      return invalid("skill name must be a skill folder name");
    }
    if (typeof item.public !== "boolean") {
      return invalid(`skill ${item.name} public must be boolean`);
    }
    if (
      !Array.isArray(item.commands) ||
      item.commands.some((name) => typeof name !== "string")
    ) {
      return invalid(`skill ${item.name} commands must be command names`);
    }
    const names = item.commands as string[];
    if (unique(names, "skill command")) {
      return invalid(`skill ${item.name} has a duplicate command`);
    }
    for (const name of names) {
      const command = byName.get(name);
      if (command === undefined) {
        return invalid(`skill ${item.name} uses unknown command ${name}`);
      }
      if (item.public && !command.public) {
        return invalid(
          `public skill ${item.name} uses non-public command ${name}`,
        );
      }
    }
    skills.push({
      name: item.name,
      public: item.public,
      commands: [...names].sort(),
    });
  }
  if (
    unique(
      skills.map((skill) => skill.name),
      "skill",
    )
  ) {
    return invalid("duplicate skill");
  }
  return {
    ok: true,
    value: sortBy(skills, (skill) => skill.name),
  };
}

export function validateDeclaration(
  value: unknown,
  options?: DeclarationOptions,
): ValidationResult<AppDeclaration> {
  if (!isObject(value)) return invalid("declaration must be an object");
  if (asJson(value) === undefined) return invalid("declaration is not JSON");
  if (options !== undefined && !isObject(options)) {
    return invalid("declaration options must be an object");
  }
  if (options && exactKeys(options, ["app", "slug"], [])) {
    return invalid("declaration options have an unknown field");
  }
  const owner = options?.app;
  if (
    owner !== undefined &&
    (typeof owner !== "string" || !APP_ID.test(owner))
  ) {
    return invalid("owner app must be an app ID");
  }
  const slug = options?.slug;
  if (slug !== undefined && typeof slug !== "string") {
    return invalid("slug must be a string");
  }
  const unexpected = exactKeys(
    value,
    DECLARATION_KEYS,
    DECLARATION_REQUIRED_KEYS,
  );
  if (unexpected) return invalid(`declaration ${unexpected}`);
  if (!nonBlank(value.name)) return invalid("declaration name is blank");
  if (!singleLine(value.description)) {
    return invalid("declaration description must be one line");
  }
  if (Object.hasOwn(value, "icon") && iconPath(value.icon)) {
    return invalid(iconPath(value.icon)!);
  }
  const permissionItems = value.permissions;
  const connectionItems = value.app_connections;
  const dependencyItems = value.sdk_dependencies;
  if (
    !Array.isArray(value.screens) ||
    !Array.isArray(value.operations) ||
    !Array.isArray(value.commands) ||
    !Array.isArray(permissionItems) ||
    !Array.isArray(connectionItems) ||
    !Array.isArray(dependencyItems)
  ) {
    return invalid("declaration collections must be arrays");
  }

  const declared = validateLayers(
    value.screens,
    value.operations,
    value.commands,
    slug,
  );
  if (!declared.ok) return declared;
  const { screens, operations, commands } = declared.value;

  const skills = validateSkills(value.skills, commands);
  if (!skills.ok) return skills;

  const permissions: PermissionRequirement[] = [];
  const kinds = new Set<PermissionKind>([
    "fs.read",
    "fs.write",
    "net.fetch",
    "net.listen",
    "secret.use",
  ]);
  for (const item of permissionItems) {
    if (!isObject(item)) return invalid("permission must be an object");
    const bad = exactKeys(
      item,
      ["kind", "reason", "scope"],
      ["kind", "reason", "scope"],
    );
    if (bad) return invalid(`permission ${bad}`);
    if (!kinds.has(item.kind as PermissionKind)) {
      return invalid("permission kind is not a declaration requirement");
    }
    if (!nonBlank(item.reason)) return invalid("permission reason is blank");
    const scope = permissionScope(item.kind as PermissionKind, item.scope);
    if (!scope.ok) return scope;
    permissions.push({
      kind: item.kind as PermissionKind,
      scope: scope.value,
      reason: item.reason,
    });
  }
  if (
    unique(
      permissions.map((permission) =>
        scopeKey(permission.kind, permission.scope),
      ),
      "permission",
    )
  )
    return invalid("duplicate permission");
  // secret 이름 하나에 인증 방식 하나다. OAuth 상태가 이름마다 하나라서다.
  if (
    unique(
      permissions
        .filter((permission) => permission.kind === "secret.use")
        .map((permission) => (permission.scope as { name: string }).name),
      "secret",
    )
  )
    return invalid("duplicate permission");

  const uses = validateUses(connectionItems, dependencyItems, owner);
  if (!uses.ok) return uses;
  const connections = uses.value.connections;
  const dependencies = uses.value.dependencies;

  const declaration: AppDeclaration = {
    name: value.name,
    description: value.description,
    // 없으면 칸을 두지 않는다. 옛 선언의 hash가 그대로이다.
    ...(typeof value.icon === "string" ? { icon: value.icon } : {}),
    ...(skills.value.length > 0 ? { skills: skills.value } : {}),
    screens: sortBy(screens, (screen) => screen.key),
    operations: sortBy(operations, (operation) => operation.name),
    commands: sortBy(commands, (command) => command.name),
    permissions: [...permissions].sort((left, right) =>
      scopeKey(left.kind, left.scope) < scopeKey(right.kind, right.scope)
        ? -1
        : 1,
    ),
    app_connections: [...connections].sort((left, right) =>
      left.app < right.app ? -1 : left.app > right.app ? 1 : 0,
    ),
    sdk_dependencies: [...dependencies].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    ),
  };
  return {
    ok: true,
    value: normalizeJson(declaration as unknown as JsonValue) as AppDeclaration,
  };
}
