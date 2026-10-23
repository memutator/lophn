// 의존성 없는 blueprint 정본.
// Zod·Deno·node·npm·jsr·IO·앱 코드 실행이 없다.
// no-input hash의 정규 JSON null은 tool·schema·release 결합을 대신하지 않는다.

import {
  APP_ID,
  asJson,
  type Blueprint,
  BLUEPRINT_KEYS,
  type BlueprintOptions,
  DOMAIN_NAME,
  exactKeys,
  invalid,
  isObject,
  type JsonValue,
  nonBlank,
  type PermissionKind,
  type PermissionRequirement,
  singleLine,
  type ValidationResult,
} from "./types.ts";
import { normalizeJson, sortBy, unique } from "./json.ts";
import { validateScreensAndTools } from "./tools.ts";
import { validateUses } from "./uses.ts";
import { permissionScope, scopeKey } from "./scope.ts";

export function validateBlueprint(
  value: unknown,
  options?: BlueprintOptions,
): ValidationResult<Blueprint> {
  if (!isObject(value)) return invalid("blueprint must be an object");
  if (asJson(value) === undefined) return invalid("blueprint is not JSON");
  if (options !== undefined && !isObject(options)) {
    return invalid("blueprint options must be an object");
  }
  if (options && exactKeys(options, ["app", "domains"], [])) {
    return invalid("blueprint options have an unknown field");
  }
  const owner = options?.app;
  if (
    owner !== undefined &&
    (typeof owner !== "string" || !APP_ID.test(owner))
  ) {
    return invalid("owner app must be an app ID");
  }
  const domains = options?.domains;
  if (
    domains !== undefined &&
    (!Array.isArray(domains) ||
      domains.some((name) =>
        typeof name !== "string" || name.length > 63 ||
        !DOMAIN_NAME.test(name)
      ))
  ) {
    return invalid("domains must be domain names");
  }
  const unexpected = exactKeys(value, BLUEPRINT_KEYS, BLUEPRINT_KEYS);
  if (unexpected) return invalid(`blueprint ${unexpected}`);
  if (!nonBlank(value.name)) return invalid("blueprint name is blank");
  if (!singleLine(value.description)) {
    return invalid("blueprint description must be one line");
  }
  const permissionItems = value.permissions;
  const connectionItems = value.app_connections;
  const dependencyItems = value.sdk_dependencies;
  if (
    !Array.isArray(value.screens) || !Array.isArray(value.tools) ||
    !Array.isArray(permissionItems) || !Array.isArray(connectionItems) ||
    !Array.isArray(dependencyItems)
  ) {
    return invalid("blueprint collections must be arrays");
  }

  const declared = validateScreensAndTools(
    value.screens,
    value.tools,
    domains,
  );
  if (!declared.ok) return declared;
  const screens = declared.value.screens;
  const tools = declared.value.tools;

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
    const bad = exactKeys(item, ["kind", "reason", "scope"], [
      "kind",
      "reason",
      "scope",
    ]);
    if (bad) return invalid(`permission ${bad}`);
    if (!kinds.has(item.kind as PermissionKind)) {
      return invalid("permission kind is not a blueprint requirement");
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
        scopeKey(permission.kind, permission.scope)
      ),
      "permission",
    )
  ) return invalid("duplicate permission");
  // secret 이름 하나에 인증 방식 하나다. OAuth 상태가 이름마다 하나라서다.
  if (
    unique(
      permissions.filter((permission) => permission.kind === "secret.use")
        .map((permission) => (permission.scope as { name: string }).name),
      "secret",
    )
  ) return invalid("duplicate permission");

  const uses = validateUses(connectionItems, dependencyItems, owner);
  if (!uses.ok) return uses;
  const connections = uses.value.connections;
  const dependencies = uses.value.dependencies;

  const blueprint: Blueprint = {
    name: value.name,
    description: value.description,
    screens: sortBy(screens, (screen) => screen.key),
    tools: sortBy(tools, (tool) => tool.name),
    permissions: [...permissions].sort((left, right) =>
      scopeKey(left.kind, left.scope) < scopeKey(right.kind, right.scope)
        ? -1
        : 1
    ),
    app_connections: [...connections].sort((left, right) =>
      left.app < right.app ? -1 : left.app > right.app ? 1 : 0
    ),
    sdk_dependencies: [...dependencies].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    ),
  };
  return {
    ok: true,
    value: normalizeJson(blueprint as unknown as JsonValue) as Blueprint,
  };
}
