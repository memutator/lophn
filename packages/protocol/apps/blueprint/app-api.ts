// 의존성 없는 blueprint 정본.
// Zod·Deno·node·npm·jsr·IO·앱 코드 실행이 없다.

import {
  type AppApiDeclaration,
  exactKeys,
  type InputSchema,
  invalid,
  isObject,
  nonBlank,
  type ScreenDeclaration,
  type ScreenSize,
  type ValidationResult,
} from "./types.ts";
import { unique } from "./json.ts";
import { validateSchemaNode } from "./schema.ts";
import { screenPath } from "./scope.ts";

// appApiKeySchema(channel-values.ts)와 같은 검사. 이 file은 의존성이 없어 따로 쓴다.
function appApiKey(value: unknown): value is string {
  return nonBlank(value) && value.trim() === value &&
    !/\p{Cc}/u.test(value) && !value.includes("*");
}

function blankDescription(schema: InputSchema): string | undefined {
  if (
    Object.hasOwn(schema, "description") && !nonBlank(schema.description)
  ) {
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

export function validateScreensAndApis(
  screenItems: unknown[],
  apiItems: unknown[],
): ValidationResult<{
  screens: ScreenDeclaration[];
  app_api: AppApiDeclaration[];
}> {
  const screens: ScreenDeclaration[] = [];
  for (const item of screenItems) {
    if (!isObject(item)) return invalid("screen must be an object");
    const bad = exactKeys(item, ["key", "label", "path", "sizes"], [
      "key",
      "label",
      "path",
      "sizes",
    ]);
    if (bad) return invalid(`screen ${bad}`);
    if (!nonBlank(item.key) || !nonBlank(item.label)) {
      return invalid("screen key and label must be nonblank");
    }
    if (screenPath(item.path)) return invalid(screenPath(item.path)!);
    if (!Array.isArray(item.sizes) || item.sizes.length === 0) {
      return invalid("screen sizes must be nonempty");
    }
    if (
      item.sizes.some((size) =>
        size !== "full" && size !== "panel" && size !== "card"
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
  if (unique(screens.map((screen) => screen.key), "screen")) {
    return invalid("duplicate screen");
  }

  const apis: AppApiDeclaration[] = [];
  for (const item of apiItems) {
    if (!isObject(item)) return invalid("app-api must be an object");
    const keys = [
      "description",
      "effect",
      "input",
      "key",
      "label",
      "project_scope",
    ];
    const bad = exactKeys(item, keys, keys);
    if (bad) return invalid(`app-api ${bad}`);
    if (
      !nonBlank(item.key) || !nonBlank(item.label) ||
      !nonBlank(item.description)
    ) {
      return invalid("app-api key, label, and description must be nonblank");
    }
    if (!appApiKey(item.key)) {
      return invalid(
        "app-api key cannot be padded, a wildcard, or contain controls",
      );
    }
    if (
      item.effect !== "read" && item.effect !== "write" &&
      item.effect !== "external"
    ) {
      return invalid("app-api effect is unsupported");
    }
    if (typeof item.project_scope !== "boolean") {
      return invalid("app-api project_scope must be boolean");
    }
    let input: InputSchema | null;
    if (item.input === null) input = null;
    else {
      const parsed = validateSchemaNode(
        item.input,
        `app-api ${item.key} input`,
      );
      if (!parsed.ok) return parsed;
      const blank = blankDescription(parsed.value);
      if (blank) return invalid(`app-api ${item.key} input ${blank}`);
      input = parsed.value;
    }
    apis.push({
      key: item.key,
      label: item.label,
      description: item.description,
      effect: item.effect,
      input,
      project_scope: item.project_scope,
    });
  }
  if (unique(apis.map((api) => api.key), "app-api")) {
    return invalid("duplicate app-api");
  }

  return { ok: true, value: { screens, app_api: apis } };
}
