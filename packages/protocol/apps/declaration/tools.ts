// 의존성 없는 선언 정본.
// Zod·node·npm·IO·앱 코드 실행이 없다.
// 화면, operation, command 선언을 검사한다(file 이름은 vendor 목록 때문에 옛 이름을 둔다).
import {
  type CommandDeclaration,
  exactKeys,
  type InputSchema,
  invalid,
  isObject,
  nonBlank,
  type OperationDeclaration,
  RUNS_ON_FORMS,
  type RunsOn,
  type ScreenDeclaration,
  type SubscriptionDeclaration,
  subscriptionHandlerName,
  DESTINATION_NAME_PATTERN,
  type Place,
  type ToolEffect,
  type TraySize,
  type ValidationResult,
} from "./types.ts";
import { unique } from "./json.ts";
import { validateSchemaNode } from "./schema.ts";
import { screenPath } from "./scope.ts";

// toolNameSchema(channel-values.ts)와 같은 규칙이다.
// 이 file은 의존성이 없어 따로 쓴다.
export const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
// protocol/lophn-agent/tool-catalog.ts의 TOOL_NAME_MAX와 같은 값이다. 이 file은 의존성이 없어 따로 쓴다.
const WIRE_NAME_MAX = 64;

export const kebab = (name: string): string => name.replaceAll("_", "-");

export function wordsOf(name: string): string[] {
  return name.split(".").map(kebab);
}

const PLACES: readonly unknown[] = [
  "tab",
  "panel",
  "card",
  "sidebar",
  "tray",
  "phone",
];
// tray popup 크기의 범위(px). 창이 더 작으면 shell이 창 안으로 줄인다.
const TRAY_SIZE = {
  width: { min: 240, max: 720 },
  height: { min: 160, max: 720 },
} as const;

function blankDescription(schema: InputSchema): string | undefined {
  if (Object.hasOwn(schema, "description") && !nonBlank(schema.description)) {
    return "description must be nonblank";
  }
  if (schema.properties) {
    for (const [name, property] of Object.entries(schema.properties)) {
      const blank = blankDescription(property);
      if (blank) return `properties.${name} ${blank}`;
    }
  }
  if (schema.items) {
    const blank = blankDescription(schema.items);
    if (blank) return `items ${blank}`;
  }
}

function traySize(
  value: unknown,
  places: unknown[],
  key: string,
): ValidationResult<TraySize> {
  if (!places.includes("tray")) {
    return invalid(`screen ${key} tray needs the tray place`);
  }
  if (!isObject(value)) return invalid(`screen ${key} tray must be an object`);
  const bad = exactKeys(value, ["width", "height"], []);
  if (bad) return invalid(`screen ${key} tray ${bad}`);
  if (!Object.hasOwn(value, "width") && !Object.hasOwn(value, "height")) {
    return invalid(`screen ${key} tray needs width or height`);
  }
  const size: TraySize = {};
  for (const side of ["width", "height"] as const) {
    if (!Object.hasOwn(value, side)) continue;
    const given = value[side];
    const { min, max } = TRAY_SIZE[side];
    const inRange = (n: unknown): n is number =>
      Number.isInteger(n) && (n as number) >= min && (n as number) <= max;
    const bad = invalid(
      `screen ${key} tray ${side} must be an integer from ${min} to ${max}, or {min?, max?} of such integers`,
    );
    if (typeof given === "number") {
      if (!inRange(given)) return bad;
      size[side] = given;
      continue;
    }
    if (!isObject(given)) return bad;
    const extra = exactKeys(given, ["min", "max"], []);
    if (extra) return invalid(`screen ${key} tray ${side} ${extra}`);
    if (!Object.hasOwn(given, "min") && !Object.hasOwn(given, "max")) {
      return invalid(`screen ${key} tray ${side} needs min or max`);
    }
    const range: { min?: number; max?: number } = {};
    for (const bound of ["min", "max"] as const) {
      if (!Object.hasOwn(given, bound)) continue;
      if (!inRange(given[bound])) return bad;
      range[bound] = given[bound];
    }
    if (
      range.min !== undefined &&
      range.max !== undefined &&
      range.min > range.max
    ) {
      return invalid(`screen ${key} tray ${side} min is greater than max`);
    }
    size[side] = range;
  }
  return { ok: true, value: size };
}

// runs_on의 모양(정규 꼴 셋 중 하나)과 앱이 가진 것과의 맞물림. ["phone"] 앱은 컴퓨터에서 도는 것이 없어서
// command·구독·external operation·widgets·폰 밖 자리의 화면이 있으면 그것을 돌릴 곳이 없다.
export function validateRunsOn(
  runsOn: unknown,
  app: {
    screens: readonly ScreenDeclaration[];
    operations: readonly OperationDeclaration[];
    commands: readonly CommandDeclaration[];
    subscriptions: readonly unknown[];
    widgets: readonly unknown[];
  },
): ValidationResult<RunsOn | undefined> {
  if (runsOn === undefined) return { ok: true, value: undefined };
  const form = RUNS_ON_FORMS.find(
    (candidate) => JSON.stringify(candidate) === JSON.stringify(runsOn),
  );
  if (form === undefined) {
    return invalid(
      'runs_on must be ["computer"], ["computer","phone"] or ["phone"]',
    );
  }
  const phoneScreen = (screen: ScreenDeclaration) =>
    screen.places.length === 1 && screen.places[0] === "phone";
  if (form.includes("phone") && !app.screens.some(phoneScreen)) {
    return invalid("runs_on: phone needs a screen with the phone place");
  }
  if (
    form.length === 1 &&
    form[0] === "phone" &&
    (app.commands.length > 0 ||
      app.subscriptions.length > 0 ||
      app.operations.some((operation) => operation.effect === "external") ||
      app.widgets.length > 0 ||
      app.screens.some((screen) => !phoneScreen(screen)))
  ) {
    return invalid(
      'runs_on ["phone"]: commands, subscriptions, external operations, widgets and places other than phone have nothing to run them',
    );
  }
  return { ok: true, value: [...form] };
}

// 한 선언이 보낼 수 있는 table의 수.
const SYNC_TABLES_MAX = 256;
// lophn(`lophn_`)과 SQLite(`sqlite_`)의 표는 앱 data가 아니다.
const RESERVED_TABLE = /^(lophn_|sqlite_)/i;

// sync의 모양(table 이름 → destination 이름)과 runs_on과의 짝. 비면 칸이 없는 것과 같다. table이 앱 DB에 있고 PK가
// 있는지는 release 준비가 target schema의 DB에서 본다. ["phone"] 앱은 컴퓨터 사본이 없어서 폴더로 보낼 data가 없다.
export function validateSync(
  sync: unknown,
  runsOn: RunsOn | undefined,
): ValidationResult<Record<string, string> | undefined> {
  if (sync === undefined) return { ok: true, value: undefined };
  if (!isObject(sync)) {
    return invalid(
      "sync must be an object that maps a table name to a destination name",
    );
  }
  const entries = Object.entries(sync);
  if (entries.length === 0) return { ok: true, value: undefined };
  if (entries.length > SYNC_TABLES_MAX) {
    return invalid(`sync lists more than ${SYNC_TABLES_MAX} tables`);
  }
  for (const [table, destination] of entries) {
    if (!nonBlank(table) || table.length > 128 || RESERVED_TABLE.test(table)) {
      return invalid(
        `sync table "${table}" is not an app table name (lophn_ and sqlite_ tables are not app data)`,
      );
    }
    if (
      typeof destination !== "string" ||
      !DESTINATION_NAME_PATTERN.test(destination)
    ) {
      return invalid(
        `sync.${table} must be a destination name: lowercase letters, digits and -, starting with a letter, up to 32`,
      );
    }
  }
  if (new Set(entries.map(([, destination]) => destination)).size > 1) {
    return invalid(
      "sync sends every listed table to one destination for now: use the same destination name for each table",
    );
  }
  if (runsOn?.length === 1 && runsOn[0] === "phone") {
    return invalid(
      'runs_on ["phone"]: sync has nothing to send; a phone\'s data reaches a folder only through a computer',
    );
  }
  return {
    ok: true,
    value: Object.fromEntries(entries) as Record<string, string>,
  };
}

// 옛 release의 봉인한 선언이 가진 sync_to(destination 이름 하나, 모든 table). 다시 읽을 때만 받는다(`sealed`).
export function validateSealedSyncTo(
  syncTo: unknown,
): ValidationResult<string | undefined> {
  if (syncTo === undefined) return { ok: true, value: undefined };
  return typeof syncTo === "string" && DESTINATION_NAME_PATTERN.test(syncTo)
    ? { ok: true, value: syncTo }
    : invalid("sync_to must be a destination name");
}

export function validateLayers(
  screenItems: unknown[],
  operationItems: unknown[],
  commandItems: unknown[],
  slug?: string,
): ValidationResult<{
  screens: ScreenDeclaration[];
  operations: OperationDeclaration[];
  commands: CommandDeclaration[];
}> {
  const screens: ScreenDeclaration[] = [];
  for (const item of screenItems) {
    if (!isObject(item)) return invalid("screen must be an object");
    const bad = exactKeys(
      item,
      ["key", "label", "path", "places", "params", "tray"],
      ["key", "label", "path", "places"],
    );
    if (bad) return invalid(`screen ${bad}`);
    if (!nonBlank(item.key) || !nonBlank(item.label)) {
      return invalid("screen key and label must be nonblank");
    }
    if (screenPath(item.path)) return invalid(screenPath(item.path)!);
    if (!Array.isArray(item.places) || item.places.length === 0) {
      return invalid("screen places must be nonempty");
    }
    if (item.places.some((place) => !PLACES.includes(place))) {
      return invalid("screen place is unsupported");
    }
    if (new Set(item.places).size !== item.places.length) {
      return invalid("screen places are duplicated");
    }
    if (item.places.includes("phone") && item.places.length > 1) {
      return invalid(
        `screen ${item.key}: phone is its own place; it cannot be combined with tab, panel, card, sidebar or tray`,
      );
    }
    let params: InputSchema | undefined;
    if (Object.hasOwn(item, "params")) {
      const parsed = objectSchema(item.params, `screen ${item.key} params`);
      if (!parsed.ok) return parsed;
      params = parsed.value;
    }
    let tray: TraySize | undefined;
    if (Object.hasOwn(item, "tray")) {
      const parsed = traySize(item.tray, item.places, item.key);
      if (!parsed.ok) return parsed;
      tray = parsed.value;
    }
    screens.push({
      key: item.key,
      label: item.label,
      path: item.path as string,
      places: [...item.places] as Place[],
      ...(params ? { params } : {}),
      ...(tray ? { tray } : {}),
    });
  }
  if (
    unique(
      screens.map((screen) => screen.key),
      "screen",
    )
  ) {
    return invalid("duplicate screen");
  }

  const operations: OperationDeclaration[] = [];
  for (const item of operationItems) {
    if (!isObject(item)) return invalid("operation must be an object");
    const bad = exactKeys(
      item,
      ["effect", "name", "title"],
      ["effect", "name", "title"],
    );
    if (bad) return invalid(`operation ${bad}`);
    if (typeof item.name !== "string" || !TOOL_NAME.test(item.name)) {
      return invalid(
        "operation name must be 1-64 characters of letters, digits, _ - .",
      );
    }
    if (!nonBlank(item.title)) {
      return invalid(`operation ${item.name} title must be nonblank`);
    }
    if (!isEffect(item.effect)) {
      return invalid(`operation ${item.name} effect is unsupported`);
    }
    operations.push({
      name: item.name,
      title: item.title,
      effect: item.effect,
    });
  }

  const commands: CommandDeclaration[] = [];
  const cliNames = new Map<string, string>();
  for (const item of commandItems) {
    if (!isObject(item)) return invalid("command must be an object");
    const bad = exactKeys(
      item,
      ["description", "effect", "inputSchema", "name", "public"],
      ["description", "effect", "inputSchema", "name", "public"],
    );
    if (bad) return invalid(`command ${bad}`);
    if (typeof item.name !== "string" || !TOOL_NAME.test(item.name)) {
      return invalid(
        "command name must be 1-64 characters of letters, digits, _ - .",
      );
    }
    if (!nonBlank(item.description)) {
      return invalid(`command ${item.name} description must be nonblank`);
    }
    if (!isEffect(item.effect)) {
      return invalid(`command ${item.name} effect is unsupported`);
    }
    if (typeof item.public !== "boolean") {
      return invalid(`command ${item.name} public must be boolean`);
    }
    const inputSchema =
      item.inputSchema === null
        ? ({ ok: true, value: null } as const)
        : objectSchema(item.inputSchema, `command ${item.name} inputSchema`);
    if (!inputSchema.ok) return inputSchema;
    const cliName = wordsOf(item.name).join(" ");
    const previous = cliNames.get(cliName);
    if (previous !== undefined) {
      return invalid(
        `commands ${previous} and ${item.name} have the same CLI name ${cliName}`,
      );
    }
    cliNames.set(cliName, item.name);
    const flags = new Map<string, string>();
    for (const [name, property] of Object.entries(
      inputSchema.value?.properties ?? {},
    )) {
      const names = [`--${kebab(name)}`];
      if (property.type === "boolean") names.push(`--no-${kebab(name)}`);
      for (const flag of names) {
        if (flag === "--on") {
          return invalid(
            `command ${item.name} field ${name} has the CLI flag --on, which picks a machine`,
          );
        }
        const previous = flags.get(flag);
        if (previous !== undefined) {
          return invalid(
            `command ${item.name} fields ${previous} and ${name} have the same CLI flag ${flag}`,
          );
        }
        flags.set(flag, name);
      }
    }
    commands.push({
      name: item.name,
      description: item.description,
      inputSchema: inputSchema.value,
      effect: item.effect,
      public: item.public,
    });
  }
  // handler는 이름 하나로 등록하므로 operation과 command의 이름은 합쳐 하나다.
  if (
    unique(
      [...operations, ...commands].map((entry) => entry.name),
      "handler",
    )
  ) {
    return invalid("duplicate operation or command name");
  }
  // 명령 이름은 `lophn <slug> <command>`로 부르지만, 이름 하나를 `<slug>_<command의 . → _>`로 줄여 쓰는 곳이 있어
  // `event.list`와 `event_list`는 같은 이름이 되고 64자를 넘으면 불리지 않는다.
  // agent에게 보이는 것은 command뿐이라 command에만 건다. slug를 모르면(SDK의 defineApp) 검사하지 않고 release 준비가 본다.
  const seen = new Map<string, string>();
  for (const command of slug === undefined ? [] : commands) {
    const wire = `${slug}_${command.name.replaceAll(".", "_")}`;
    if (wire.length > WIRE_NAME_MAX) {
      return invalid(
        `command ${command.name} has the agent tool name ${wire} longer than ${WIRE_NAME_MAX} characters`,
      );
    }
    const other = seen.get(wire);
    if (other !== undefined) {
      return invalid(
        `commands ${other} and ${command.name} have the same agent tool name ${wire}`,
      );
    }
    seen.set(wire, command.name);
  }

  return { ok: true, value: { screens, operations, commands } };
}

function isEffect(value: unknown): value is ToolEffect {
  return value === "read" || value === "write" || value === "external";
}

export function objectSchema(
  value: unknown,
  label: string,
): ValidationResult<InputSchema> {
  const parsed = validateSchemaNode(value, label);
  if (!parsed.ok) return parsed;
  if (parsed.value.type !== "object") {
    return invalid(`${label} root type must be object`);
  }
  const blank = blankDescription(parsed.value);
  if (blank) return invalid(`${label} ${blank}`);
  return parsed;
}

// handler가 이름 하나로 등록되므로 선언과 대조하는 이름은 operation과 command를 합친 목록이다.
// 앱이 반드시 등록해야 하는 handler(operation과 command)다. 구독 handler는 뺀다: 구독을 선언했어도 handler를 등록하지 않은 앱(화면만 구독하는 앱)은 process가 받지 않을 뿐 시작에는 문제없다.
export function requiredHandlerNames(declaration: {
  operations: readonly Pick<OperationDeclaration, "name">[];
  commands: readonly Pick<CommandDeclaration, "name">[];
}): string[] {
  return [
    ...declaration.operations.map((operation) => operation.name),
    ...declaration.commands.map((command) => command.name),
  ];
}

// 구독 handler(`on.<source>.<event>`)도 같은 이름 공간이다. 등록해도 되는 이름 전부다(필수는 아니다).
export function handlerNames(declaration: {
  operations: readonly Pick<OperationDeclaration, "name">[];
  commands: readonly Pick<CommandDeclaration, "name">[];
  subscriptions?: readonly SubscriptionDeclaration[];
}): string[] {
  return [
    ...declaration.operations.map((operation) => operation.name),
    ...declaration.commands.map((command) => command.name),
    ...(declaration.subscriptions ?? []).map(subscriptionHandlerName),
  ];
}
