// 의존성 없는 blueprint 정본(apps/blueprint#R16).
// Zod·Deno·node·npm·jsr·IO·앱 코드 실행이 없다.

import {
  type CommandDeclaration,
  type CommandRevertDeclaration,
  exactKeys,
  type InputSchema,
  invalid,
  isObject,
  nonBlank,
  type ScreenDeclaration,
  type ScreenSize,
  type ValidationResult,
} from "./blueprint-types.ts";
import { unique } from "./blueprint-json.ts";
import { validateSchemaNode } from "./blueprint-schema.ts";
import { screenPath } from "./blueprint-scope.ts";

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

export function validateScreensAndCommands(
  screenItems: unknown[],
  commandItems: unknown[],
): ValidationResult<{
  screens: ScreenDeclaration[];
  commands: CommandDeclaration[];
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

  const commands: CommandDeclaration[] = [];
  for (const item of commandItems) {
    if (!isObject(item)) return invalid("command must be an object");
    const bad = exactKeys(
      item,
      ["confirm", "description", "effect", "input", "key", "label", "revert"],
      ["confirm", "description", "effect", "input", "key", "label", "revert"],
    );
    if (bad) return invalid(`command ${bad}`);
    if (
      !nonBlank(item.key) || !nonBlank(item.label) ||
      !nonBlank(item.description)
    ) {
      return invalid("command key, label, and description must be nonblank");
    }
    if (
      item.effect !== "read" && item.effect !== "write" &&
      item.effect !== "external"
    ) {
      return invalid("command effect is unsupported");
    }
    if (typeof item.confirm !== "boolean") {
      return invalid("command confirm must be boolean");
    }
    let input: InputSchema | null;
    if (item.input === null) input = null;
    else {
      const parsed = validateSchemaNode(
        item.input,
        `command ${item.key} input`,
      );
      if (!parsed.ok) return parsed;
      const blank = blankDescription(parsed.value);
      if (blank) return invalid(`command ${item.key} input ${blank}`);
      input = parsed.value;
    }
    if (!isObject(item.revert)) {
      return invalid("command revert must be an object");
    }
    const revertKeys = item.revert.supported === true
      ? ["command", "supported"]
      : ["supported"];
    const revertBad = exactKeys(item.revert, revertKeys, revertKeys);
    if (revertBad) return invalid(`command revert ${revertBad}`);
    if (typeof item.revert.supported !== "boolean") {
      return invalid("revert supported must be boolean");
    }
    if (
      (item.effect === "read" || item.effect === "external") &&
      item.revert.supported
    ) {
      return invalid("read and external revert cannot be supported");
    }
    if (
      item.revert.supported === false && Object.hasOwn(item.revert, "command")
    ) {
      return invalid("unsupported revert must omit command");
    }
    const revert: CommandRevertDeclaration = {
      supported: item.revert.supported,
    };
    if (item.revert.supported) {
      if (!nonBlank(item.revert.command)) {
        return invalid("revert command is blank");
      }
      revert.command = item.revert.command as string;
    }
    commands.push({
      key: item.key,
      label: item.label,
      description: item.description,
      effect: item.effect,
      confirm: item.confirm,
      input,
      revert,
    });
  }
  if (unique(commands.map((command) => command.key), "command")) {
    return invalid("duplicate command");
  }
  const byKey = new Map(commands.map((command) => [command.key, command]));
  for (const command of commands) {
    if (!command.revert.supported) continue;
    const target = byKey.get(command.revert.command!);
    if (!target || target.effect !== "write" || target.key === command.key) {
      return invalid("supported revert needs a different write command");
    }
  }

  return { ok: true, value: { screens, commands } };
}
