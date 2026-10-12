// 의존성 없는 blueprint 정본.
// Zod·Deno·node·npm·jsr·IO·앱 코드 실행이 없다.
// no-input hash의 정규 JSON null은 command·schema·release 결합을 대신하지 않는다.

import {
  type AgentContextDeclaration,
  type AnnotationTargetDeclaration,
  APP_ID,
  asJson,
  type AutomationDeclaration,
  type AutomationWhen,
  type Blueprint,
  BLUEPRINT_KEYS,
  type BlueprintOptions,
  DOC_ID,
  type DocumentDeclaration,
  exactKeys,
  invalid,
  isObject,
  type JsonValue,
  nonBlank,
  type PermissionKind,
  type PermissionRequirement,
  type ProblemCodeDeclaration,
  singleLine,
  type ValidationResult,
} from "./blueprint-types.ts";
import { normalizeJson, sortKeys, unique } from "./blueprint-json.ts";
import { validateInput } from "./blueprint-schema.ts";
import { validateScreensAndCommands } from "./blueprint-commands.ts";
import { validateUses } from "./blueprint-uses.ts";
import {
  formatRef,
  permissionScope,
  pointer,
  problemCode,
  scopeKey,
} from "./blueprint-scope.ts";

export function validateBlueprint(
  value: unknown,
  options?: BlueprintOptions,
): ValidationResult<Blueprint> {
  if (!isObject(value)) return invalid("blueprint must be an object");
  if (asJson(value) === undefined) return invalid("blueprint is not JSON");
  if (options !== undefined && !isObject(options)) {
    return invalid("blueprint options must be an object");
  }
  if (options && exactKeys(options, ["app"], [])) {
    return invalid("blueprint options have an unknown field");
  }
  const owner = options?.app;
  if (
    owner !== undefined &&
    (typeof owner !== "string" || !APP_ID.test(owner))
  ) {
    return invalid("owner app must be an app ID");
  }
  const unexpected = exactKeys(value, BLUEPRINT_KEYS, BLUEPRINT_KEYS);
  if (unexpected) return invalid(`blueprint ${unexpected}`);
  if (!nonBlank(value.name)) return invalid("blueprint name is blank");
  if (!singleLine(value.description)) {
    return invalid("blueprint description must be one line");
  }
  if (!Array.isArray(value.screens) || !Array.isArray(value.commands)) {
    return invalid("blueprint collections must be arrays");
  }
  const automaticTasks = value.automatic_tasks;
  const permissionItems = value.permissions;
  const problemItems = value.problem_codes;
  const documentItems = value.documents;
  const contextItems = value.agent_context;
  const connectionItems = value.app_connections;
  const dependencyItems = value.sdk_dependencies;
  if (
    !Array.isArray(automaticTasks) || !Array.isArray(permissionItems) ||
    !Array.isArray(problemItems) || !Array.isArray(documentItems) ||
    !Array.isArray(contextItems) || !Array.isArray(connectionItems) ||
    !Array.isArray(dependencyItems)
  ) {
    return invalid("blueprint collections must be arrays");
  }

  const declared = validateScreensAndCommands(value.screens, value.commands);
  if (!declared.ok) return declared;
  const screens = declared.value.screens;
  const commands = declared.value.commands;
  const byKey = new Map(commands.map((command) => [command.key, command]));

  const permissions: PermissionRequirement[] = [];
  const kinds = new Set<PermissionKind>([
    "fs.read",
    "fs.write",
    "net.fetch",
    "net.listen",
    "secret.use",
    "document.save",
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

  const problemCodes: ProblemCodeDeclaration[] = [];
  for (const item of problemItems) {
    const parsed = problemCode(item);
    if (!parsed.ok) return parsed;
    problemCodes.push(parsed.value);
  }
  if (unique(problemCodes.map((problem) => problem.code), "problem code")) {
    return invalid("duplicate problem code");
  }

  const documents: DocumentDeclaration[] = [];
  for (const item of documentItems) {
    if (!isObject(item)) return invalid("document must be an object");
    const allowed = Object.hasOwn(item, "document")
      ? ["description", "document", "format", "key", "name"]
      : ["description", "format", "key", "name"];
    const bad = exactKeys(item, allowed, [
      "description",
      "format",
      "key",
      "name",
    ]);
    if (bad) return invalid(`document ${bad}`);
    if (
      !nonBlank(item.key) || !nonBlank(item.name) || !nonBlank(item.description)
    ) {
      return invalid("document text must be nonblank");
    }
    const format = formatRef(item.format);
    if (!format.ok) return format;
    const document: DocumentDeclaration = {
      key: item.key,
      name: item.name,
      description: item.description,
      format: format.value,
    };
    if (Object.hasOwn(item, "document")) {
      if (typeof item.document !== "string" || !DOC_ID.test(item.document)) {
        return invalid("document reference must be a doc ID");
      }
      document.document = item.document;
    }
    documents.push(document);
  }
  if (unique(documents.map((document) => document.key), "document")) {
    return invalid("duplicate document");
  }
  const documentKeys = new Set(documents.map((document) => document.key));
  for (const permission of permissions) {
    if (permission.kind !== "document.save") continue;
    if (!documentKeys.has((permission.scope as { key: string }).key)) {
      return invalid("document.save grant key is not declared");
    }
  }

  const automations: AutomationDeclaration[] = [];
  for (const item of automaticTasks) {
    if (!isObject(item)) return invalid("automation must be an object");
    const allowed = Object.hasOwn(item, "input")
      ? ["command", "input", "key", "label", "when"]
      : ["command", "key", "label", "when"];
    const bad = exactKeys(item, allowed, ["command", "key", "label", "when"]);
    if (bad) return invalid(`automation ${bad}`);
    if (!nonBlank(item.key) || !nonBlank(item.label)) {
      return invalid("automation key and label must be nonblank");
    }
    if (!isObject(item.when)) {
      return invalid("automation when must be an object");
    }
    let when: AutomationWhen;
    if (item.when.kind === "on_start") {
      if (exactKeys(item.when, ["kind"], ["kind"])) {
        return invalid("on_start accepts no other field");
      }
      when = { kind: "on_start" };
    } else if (item.when.kind === "interval") {
      if (
        exactKeys(item.when, ["interval_ms", "kind"], ["interval_ms", "kind"])
      ) {
        return invalid("interval has an unknown field");
      }
      if (
        typeof item.when.interval_ms !== "number" ||
        !Number.isSafeInteger(item.when.interval_ms) ||
        item.when.interval_ms < 60000
      ) {
        return invalid("interval_ms must be at least 60000");
      }
      when = { kind: "interval", interval_ms: item.when.interval_ms };
    } else return invalid("automation trigger is unsupported");
    const command = byKey.get(item.command as string);
    if (!command) return invalid("automation command does not exist");
    if (command.confirm) {
      return invalid("automation command cannot require confirm");
    }
    const automation: AutomationDeclaration = {
      key: item.key,
      label: item.label,
      when,
      command: command.key,
    };
    if (Object.hasOwn(item, "input")) {
      const checked = validateInput(command.input, item.input);
      if (!checked.ok) return checked;
      if (checked.value !== undefined) automation.input = checked.value;
    } else if (command.input !== null) {
      const checked = validateInput(command.input, undefined);
      if (!checked.ok) {
        return invalid("automation input does not satisfy the command");
      }
      if (checked.value !== undefined) automation.input = checked.value;
    }
    automations.push(automation);
  }
  if (unique(automations.map((automation) => automation.key), "automation")) {
    return invalid("duplicate automation");
  }

  const contexts: AgentContextDeclaration[] = [];
  for (const item of contextItems) {
    if (!isObject(item)) return invalid("agent context must be an object");
    const bad = exactKeys(
      item,
      ["annotation_targets", "read_command", "screen", "sensitive_paths"],
      ["annotation_targets", "read_command", "screen", "sensitive_paths"],
    );
    if (bad) return invalid(`agent context ${bad}`);
    if (!screens.some((screen) => screen.key === item.screen)) {
      return invalid("agent context screen is not declared");
    }
    const read = byKey.get(item.read_command as string);
    if (!read || read.effect !== "read" || read.confirm) {
      return invalid(
        "agent context read command must be read and confirm false",
      );
    }
    if (!Array.isArray(item.sensitive_paths)) {
      return invalid("sensitive paths must be an array");
    }
    if (item.sensitive_paths.some((path) => !pointer(path))) {
      return invalid("sensitive path must be a JSON Pointer");
    }
    if (unique(item.sensitive_paths as string[], "sensitive path")) {
      return invalid("duplicate sensitive path");
    }
    if (!Array.isArray(item.annotation_targets)) {
      return invalid("annotation targets must be an array");
    }
    const targets: AnnotationTargetDeclaration[] = [];
    for (const target of item.annotation_targets) {
      if (!isObject(target)) {
        return invalid("annotation target must be an object");
      }
      const targetBad = exactKeys(
        target,
        ["key", "label", "write_command"],
        ["key", "label", "write_command"],
      );
      if (targetBad) return invalid(`annotation target ${targetBad}`);
      if (!nonBlank(target.key) || !nonBlank(target.label)) {
        return invalid("annotation target text must be nonblank");
      }
      const write = byKey.get(target.write_command as string);
      if (!write || write.effect !== "write") {
        return invalid("annotation target command must be write");
      }
      targets.push({
        key: target.key,
        label: target.label,
        write_command: write.key,
      });
    }
    if (unique(targets.map((target) => target.key), "annotation target")) {
      return invalid("duplicate annotation target");
    }
    contexts.push({
      screen: item.screen as string,
      read_command: read.key,
      sensitive_paths: [...item.sensitive_paths as string[]].sort(),
      annotation_targets: sortKeys(targets),
    });
  }
  if (unique(contexts.map((context) => context.screen), "agent context")) {
    return invalid("duplicate agent context");
  }

  const uses = validateUses(connectionItems, dependencyItems, owner);
  if (!uses.ok) return uses;
  const connections = uses.value.connections;
  const dependencies = uses.value.dependencies;

  const blueprint: Blueprint = {
    name: value.name,
    description: value.description,
    screens: sortKeys(screens),
    commands: sortKeys(commands),
    automatic_tasks: sortKeys(automations),
    permissions: [...permissions].sort((left, right) =>
      scopeKey(left.kind, left.scope) < scopeKey(right.kind, right.scope)
        ? -1
        : 1
    ),
    problem_codes: [...problemCodes].sort((left, right) =>
      left.code < right.code ? -1 : left.code > right.code ? 1 : 0
    ),
    documents: sortKeys(documents),
    agent_context: [...contexts].sort((left, right) =>
      left.screen < right.screen ? -1 : left.screen > right.screen ? 1 : 0
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
