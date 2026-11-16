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
  type AppKeyDeclaration,
  type DeclarationOptions,
  type EventDeclaration,
  exactKeys,
  invalid,
  isObject,
  type JsonValue,
  lengthOf,
  nonBlank,
  type PermissionKind,
  type PermissionRequirement,
  type ScreenDeclaration,
  singleLine,
  type SkillDeclaration,
  type SubscriptionDeclaration,
  type WidgetDeclaration,
  WIDGET_KEY_PATTERN,
  WIDGETS_MAX,
  LOPHN_EVENT_SOURCE,
  subscriptionHandlerName,
  type ValidationResult,
} from "./types.ts";
import { normalizeJson, sortBy, unique } from "./json.ts";
import {
  objectSchema,
  TOOL_NAME,
  validateLayers,
  validateRunsOn,
} from "./tools.ts";
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

// 앱이 내는 key(`keys`)의 검사. 앱 key는 홑 타만 받는다(연속 key는 앱 page가 맞추지 않는다). 글 입력을 삼키지
// 않게 modifier가 있거나 F키여야 한다. key 이름 목록은 protocol의 shell/keybindings.ts와 같다(의존 없이 두려고 옮겨 적었다).
const NAMED_KEYS =
  "Backquote|Backslash|BracketLeft|BracketRight|Comma|Period|Slash|Semicolon|Quote|Minus|Equal|" +
  "ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown|Home|End|Tab|Enter|Space|Escape|" +
  "Backspace|Delete|Insert";
const WITH_MODIFIER = new RegExp(
  `^(?:(?:Ctrl|Cmd|Alt|Shift)\\+)+(?:Key[A-Z]|Digit[0-9]|F[1-9]|F1[0-2]|${NAMED_KEYS})$`,
);
const FUNCTION_KEY = /^F(?:1[0-2]|[1-9])$/;

function keyChordOk(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (WITH_MODIFIER.test(value) || FUNCTION_KEY.test(value))
  );
}

export function validateKeys(
  items: unknown,
): ValidationResult<AppKeyDeclaration[]> {
  if (items === undefined) return { ok: true, value: [] };
  if (!Array.isArray(items)) return invalid("keys must be an array");
  const keys: AppKeyDeclaration[] = [];
  for (const item of items) {
    if (!isObject(item)) return invalid("key must be an object");
    const bad = exactKeys(
      item,
      ["context", "id", "key", "title"],
      ["id", "key", "title"],
    );
    if (bad) return invalid(`key ${bad}`);
    if (typeof item.id !== "string" || !TOOL_NAME.test(item.id)) {
      return invalid(
        "key name must be 1-64 characters of letters, digits, _ - .",
      );
    }
    if (!singleLine(item.title)) {
      return invalid(`key ${item.id} title must be one line of text`);
    }
    if (!isObject(item.key))
      return invalid(`key ${item.id} key must be an object`);
    const chords = exactKeys(item.key, ["mac", "other"], ["other"]);
    if (chords) return invalid(`key ${item.id} key ${chords}`);
    if (!keyChordOk(item.key.other)) {
      return invalid(
        `key ${item.id} needs a single key with a modifier or an F key`,
      );
    }
    if (item.key.mac !== undefined && !keyChordOk(item.key.mac)) {
      return invalid(
        `key ${item.id} mac needs a single key with a modifier or an F key`,
      );
    }
    if (item.context !== undefined && !singleLine(item.context)) {
      return invalid(`key ${item.id} context must be one line of text`);
    }
    keys.push({
      id: item.id,
      title: item.title,
      key: {
        other: item.key.other,
        ...(item.key.mac === undefined ? {} : { mac: item.key.mac }),
      },
      ...(item.context === undefined ? {} : { context: item.context }),
    });
  }
  const dup = unique(
    keys.map((key) => key.id),
    "key",
  );
  if (dup) return invalid(dup);
  return { ok: true, value: sortBy(keys, (key) => key.id) };
}

// 앱 slug의 모양이다(protocol/projects/values.ts의 slugSchema와 같다. 이 file은 의존성이 없어 따로 쓴다).
const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const HANDLER_NAME_MAX = 64;

function validateEvents(items: unknown): ValidationResult<EventDeclaration[]> {
  if (items === undefined) return { ok: true, value: [] };
  if (!Array.isArray(items)) return invalid("events must be an array");
  const events: EventDeclaration[] = [];
  for (const item of items) {
    if (!isObject(item)) return invalid("event must be an object");
    const bad = exactKeys(
      item,
      ["description", "name", "payloadSchema"],
      ["description", "name", "payloadSchema"],
    );
    if (bad) return invalid(`event ${bad}`);
    if (typeof item.name !== "string" || !TOOL_NAME.test(item.name)) {
      return invalid(
        "event name must be 1-64 characters of letters, digits, _ - .",
      );
    }
    if (!nonBlank(item.description)) {
      return invalid(`event ${item.name} description must be nonblank`);
    }
    const payload = objectSchema(
      item.payloadSchema,
      `event ${item.name} payloadSchema`,
    );
    if (!payload.ok) return payload;
    events.push({
      name: item.name,
      description: item.description,
      payloadSchema: payload.value,
    });
  }
  const dup = unique(
    events.map((event) => event.name),
    "event",
  );
  if (dup) return invalid(dup);
  return { ok: true, value: sortBy(events, (event) => event.name) };
}

// handler 이름은 `on.<source>.<event>`이고 operation·command와 한 이름 공간이다. 겹치면 한쪽 handler가 가려진다.
function validateSubscriptions(
  items: unknown,
  taken: readonly string[],
): ValidationResult<SubscriptionDeclaration[]> {
  if (items === undefined) return { ok: true, value: [] };
  if (!Array.isArray(items)) return invalid("subscriptions must be an array");
  const subscriptions: SubscriptionDeclaration[] = [];
  for (const item of items) {
    if (!isObject(item)) return invalid("subscription must be an object");
    const bad = exactKeys(item, ["event", "source"], ["event", "source"]);
    if (bad) return invalid(`subscription ${bad}`);
    if (
      typeof item.source !== "string" ||
      !(item.source === LOPHN_EVENT_SOURCE || SLUG.test(item.source))
    ) {
      return invalid(
        `subscription source must be "${LOPHN_EVENT_SOURCE}" or an app slug`,
      );
    }
    if (typeof item.event !== "string" || !TOOL_NAME.test(item.event)) {
      return invalid(
        "subscription event must be 1-64 characters of letters, digits, _ - .",
      );
    }
    const subscription = { source: item.source, event: item.event };
    const handler = subscriptionHandlerName(subscription);
    if (handler.length > HANDLER_NAME_MAX) {
      return invalid(
        `subscription handler ${handler} is longer than ${HANDLER_NAME_MAX} characters`,
      );
    }
    if (taken.includes(handler)) {
      return invalid(
        `subscription handler ${handler} is also an operation or command name`,
      );
    }
    subscriptions.push(subscription);
  }
  const dup = unique(
    subscriptions.map(subscriptionHandlerName),
    "subscription",
  );
  if (dup) return invalid(dup);
  return {
    ok: true,
    value: sortBy(subscriptions, (subscription) =>
      subscriptionHandlerName(subscription),
    ),
  };
}

// widget 목록의 검사. screen은 이 선언의 phone 화면(places가 ["phone"])을 가리켜야 한다.
function validateWidgets(
  items: unknown,
  screens: readonly ScreenDeclaration[],
): ValidationResult<WidgetDeclaration[]> {
  if (items === undefined) return { ok: true, value: [] };
  if (!Array.isArray(items)) return invalid("widgets must be an array");
  if (items.length > WIDGETS_MAX) {
    return invalid(`widgets must have at most ${WIDGETS_MAX} entries`);
  }
  const phoneScreens = new Set(
    screens
      .filter((screen) => screen.places.includes("phone"))
      .map((screen) => screen.key),
  );
  const widgets: WidgetDeclaration[] = [];
  for (const item of items) {
    if (!isObject(item)) return invalid("widget must be an object");
    const bad = exactKeys(item, ["key", "label", "screen"], ["key", "label"]);
    if (bad) return invalid(`widget ${bad}`);
    if (typeof item.key !== "string" || !WIDGET_KEY_PATTERN.test(item.key)) {
      return invalid(
        "widget key must be a lowercase letter then up to 31 lowercase letters, digits or _",
      );
    }
    if (!singleLine(item.label) || lengthOf(item.label) > 40) {
      return invalid(
        `widget ${item.key}: label must be one line of 1-40 characters`,
      );
    }
    if (item.screen !== undefined) {
      if (typeof item.screen !== "string" || !phoneScreens.has(item.screen)) {
        return invalid(
          `widget ${item.key}: screen must be the key of a screen whose places is ["phone"]`,
        );
      }
    }
    widgets.push({
      key: item.key,
      label: item.label,
      ...(item.screen === undefined ? {} : { screen: item.screen }),
    });
  }
  const dup = unique(
    widgets.map((widget) => widget.key),
    "widget",
  );
  if (dup) return invalid(dup);
  return { ok: true, value: widgets };
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
  const keys = validateKeys(value.keys);
  if (!keys.ok) return keys;
  const events = validateEvents(value.events);
  if (!events.ok) return events;
  const widgets = validateWidgets(value.widgets, screens);
  if (!widgets.ok) return widgets;
  const subscriptions = validateSubscriptions(value.subscriptions, [
    ...operations.map((operation) => operation.name),
    ...commands.map((command) => command.name),
  ]);
  if (!subscriptions.ok) return subscriptions;
  const runsOn = validateRunsOn(value.runs_on, {
    screens,
    operations,
    commands,
    subscriptions: subscriptions.value,
    widgets: widgets.value,
  });
  if (!runsOn.ok) return runsOn;

  const permissions: PermissionRequirement[] = [];
  const kinds = new Set<PermissionKind>([
    "fs.read",
    "fs.write",
    "net.fetch",
    "net.listen",
    "secret.use",
    "notify.send",
    "phone.use",
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
    ...(keys.value.length > 0 ? { keys: keys.value } : {}),
    ...(events.value.length > 0 ? { events: events.value } : {}),
    ...(subscriptions.value.length > 0
      ? { subscriptions: subscriptions.value }
      : {}),
    ...(widgets.value.length > 0 ? { widgets: widgets.value } : {}),
    ...(runsOn.value === undefined ? {} : { runs_on: runsOn.value }),
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
