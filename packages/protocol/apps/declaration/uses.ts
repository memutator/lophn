// 의존성 없는 선언 정본.
// Zod·Deno·node·npm·jsr·IO·앱 코드 실행이 없다.

import {
  APP_ID,
  type AppToolUseDeclaration,
  exactKeys,
  invalid,
  isObject,
  nonBlank,
  PACKAGE_NAME,
  type SDKDependency,
  type ValidationResult,
} from "./types.ts";
import { unique } from "./json.ts";
import { semver } from "./scope.ts";

export function validateUses(
  connectionItems: unknown[],
  dependencyItems: unknown[],
  owner: string | undefined,
): ValidationResult<{
  connections: AppToolUseDeclaration[];
  dependencies: SDKDependency[];
}> {
  const connections: AppToolUseDeclaration[] = [];
  for (const item of connectionItems) {
    if (!isObject(item)) return invalid("app connection must be an object");
    const bad = exactKeys(item, ["app", "tools", "reason"], [
      "app",
      "tools",
      "reason",
    ]);
    if (bad) return invalid(`app connection ${bad}`);
    if (typeof item.app !== "string" || !APP_ID.test(item.app)) {
      return invalid("app connection target must be an app ID");
    }
    if (owner !== undefined && item.app === owner) {
      return invalid("app connection cannot target the owner app");
    }
    if (!Array.isArray(item.tools) || item.tools.length === 0) {
      return invalid("app connection tools must be nonempty");
    }
    if (
      item.tools.some((name) =>
        typeof name !== "string" || name.trim() !== name ||
        !nonBlank(name) || name.includes("*")
      )
    ) {
      return invalid("app connection tool must be an exact key");
    }
    if (unique(item.tools as string[], "tool")) {
      return invalid("duplicate tool");
    }
    if (!nonBlank(item.reason)) {
      return invalid("app connection reason is blank");
    }
    connections.push({
      app: item.app,
      tools: [...item.tools as string[]].sort(),
      reason: item.reason,
    });
  }
  if (
    unique(connections.map((connection) => connection.app), "app connection")
  ) {
    return invalid("duplicate app connection");
  }

  const dependencies: SDKDependency[] = [];
  for (const item of dependencyItems) {
    if (!isObject(item)) return invalid("sdk dependency must be an object");
    const bad = exactKeys(item, ["name", "version"], ["name", "version"]);
    if (bad) return invalid(`sdk dependency ${bad}`);
    if (typeof item.name !== "string" || !PACKAGE_NAME.test(item.name)) {
      return invalid("sdk dependency name is invalid");
    }
    if (!semver(item.version)) {
      return invalid("sdk dependency version must be exact SemVer");
    }
    dependencies.push({ name: item.name, version: item.version });
  }
  if (
    unique(dependencies.map((dependency) => dependency.name), "sdk dependency")
  ) {
    return invalid("duplicate sdk dependency");
  }

  return { ok: true, value: { connections, dependencies } };
}
