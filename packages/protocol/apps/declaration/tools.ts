// 의존성 없는 선언 정본.
// Zod·node·npm·IO·앱 코드 실행이 없다.
// 화면, operation, command 선언을 검사한다(file 이름은 vendor 목록 때문에 옛 이름을 둔다).
import {
  type CommandDeclaration,
  exactKeys,
  type InputSchema,
  invalid,
  isDomainName,
  isObject,
  nonBlank,
  type OperationDeclaration,
  type ScreenDeclaration,
  type ScreenSize,
  type ToolEffect,
  type ValidationResult,
} from "./types.ts";
import { unique } from "./json.ts";
import { validateSchemaNode } from "./schema.ts";
import { screenPath } from "./scope.ts";

// toolNameSchema(channel-values.ts)와 같은 규칙이다.
// 이 file은 의존성이 없어 따로 쓴다.
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

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

export function validateLayers(
  screenItems: unknown[],
  operationItems: unknown[],
  commandItems: unknown[],
  domains?: readonly string[],
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
      ["key", "label", "path", "sizes"],
      ["key", "label", "path", "sizes"],
    );
    if (bad) return invalid(`screen ${bad}`);
    if (!nonBlank(item.key) || !nonBlank(item.label)) {
      return invalid("screen key and label must be nonblank");
    }
    if (screenPath(item.path)) return invalid(screenPath(item.path)!);
    if (!Array.isArray(item.sizes) || item.sizes.length === 0) {
      return invalid("screen sizes must be nonempty");
    }
    if (
      item.sizes.some(
        (size) => size !== "full" && size !== "panel" && size !== "card",
      )
    ) {
      return invalid("screen size is unsupported");
    }
    if (new Set(item.sizes).size !== item.sizes.length) {
      return invalid("screen sizes are duplicated");
    }
    screens.push({
      key: item.key,
      label: item.label,
      path: item.path as string,
      sizes: [...item.sizes] as ScreenSize[],
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
  for (const item of commandItems) {
    if (!isObject(item)) return invalid("command must be an object");
    const bad = exactKeys(
      item,
      ["description", "domain", "effect", "inputSchema", "name", "public"],
      ["description", "domain", "effect", "inputSchema", "name", "public"],
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
    if (typeof item.domain !== "string" || !isDomainName(item.domain)) {
      return invalid(`command ${item.name} domain must be a domain name`);
    }
    if (domains && !domains.includes(item.domain)) {
      return invalid(
        `command ${item.name} domain ${item.domain} is not a domain of this app`,
      );
    }
    const inputSchema =
      item.inputSchema === null
        ? ({ ok: true, value: null } as const)
        : objectSchema(item.inputSchema, `command ${item.name} inputSchema`);
    if (!inputSchema.ok) return inputSchema;
    commands.push({
      name: item.name,
      description: item.description,
      inputSchema: inputSchema.value,
      effect: item.effect,
      public: item.public,
      domain: item.domain,
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
  // agent tool 이름은 `<domain>_<command의 . → _>`라 `event.list`와 `event_list`는 같은 이름이 된다.
  // agent에게 보이는 것은 command뿐이라 command에만 건다.
  const seen = new Map<string, string>();
  for (const command of commands) {
    const wire = `${command.domain}_${command.name.replaceAll(".", "_")}`;
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

function objectSchema(
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
export function handlerNames(declaration: {
  operations: readonly Pick<OperationDeclaration, "name">[];
  commands: readonly Pick<CommandDeclaration, "name">[];
}): string[] {
  return [
    ...declaration.operations.map((operation) => operation.name),
    ...declaration.commands.map((command) => command.name),
  ];
}
