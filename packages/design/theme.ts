import { flatten, type FlatToken } from "./generate.ts";
import { type Theme, tokens } from "./tokens.ts";

export interface ThemeOverrideResult {
  readonly cssVariables: Record<Theme, Record<string, string>>;
  readonly rejected: readonly { name: string; reason: string }[];
}

// 작은 link 글자는 4.5:1, focus 표시는 3:1을 유지해야 override가 표면에서 사라지지 않는다.
const ACCENT_CONTRAST = { text: 4.5, focus: 3 } as const;
const HEX_COLOR = /^#[\da-f]{6}$/i;

function allowedValues(token: FlatToken): readonly string[] | undefined {
  const [group, kind, detail] = token.path;
  if (group === "space") return tokens.space;
  if (group === "radius") return Object.values(tokens.radius);
  if (group === "border") {
    return kind === "width" ? [tokens.border.width] : ["2px"];
  }
  if (group === "type") {
    if (kind === "tracking") return Object.values(tokens.type.tracking);
    return Object.values(tokens.type).flatMap((value) =>
      "size" in value ? [value[detail as "size" | "line"]] : []
    );
  }
  if (group === "font" && kind === "weight") {
    return Object.values(tokens.font.weight).map(String);
  }
  if (group === "motion") {
    if (kind === "duration") return Object.values(tokens.motion.duration);
    if (kind === "fade") return [tokens.motion.fade];
    if (kind === "pulse") return [tokens.motion.pulse];
    if (kind === "distance") return [tokens.motion.distance];
  }
  if (group === "layout") {
    const values = tokens.layout[kind as keyof typeof tokens.layout];
    return Object.values(values);
  }
  return undefined;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const light = luminance(a);
  const dark = luminance(b);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

function accentReason(
  name: string,
  values: Record<string, string>,
): string | undefined {
  const value = values[name];
  let backgrounds: string[];
  let minimum: number = ACCENT_CONTRAST.text;
  if (name === "--color-link" || name === "--color-focus") {
    backgrounds = Object.keys(tokens.color.surface).map((surface) =>
      values[`--color-surface-${surface}`]
    );
    if (name === "--color-focus") minimum = ACCENT_CONTRAST.focus;
  } else if (
    name === "--color-ink-background" || name === "--color-ink-hover"
  ) {
    backgrounds = [values["--color-ink-text"]];
  } else if (name === "--color-selection") {
    backgrounds = [values["--color-text-primary"]];
  } else return undefined;
  return backgrounds.some((background) => contrast(value, background) < minimum)
    ? `accent contrast must be at least ${minimum}:1`
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function applyThemeOverride(override: unknown): ThemeOverrideResult {
  const flat = flatten();
  const cssVariables = {
    light: Object.fromEntries(flat.map((token) => [token.name, token.light])),
    dark: Object.fromEntries(
      flat.map((token) => [token.name, token.dark ?? token.light]),
    ),
  };
  const rejected: { name: string; reason: string }[] = [];
  const reject = (name: string, reason: string) =>
    rejected.push({ name, reason });
  if (!isRecord(override)) {
    reject("override", "invalid_input: expected token value object");
    return { cssVariables, rejected };
  }
  const byName = new Map(flat.map((token) => [token.name, token]));
  const changed: Record<Theme, Set<string>> = {
    light: new Set(),
    dark: new Set(),
  };
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(override)) {
    const token = byName.get(name) ??
      flat.find((item) => item.path.join(".") === name);
    if (!token) {
      reject(name, "invalid_input: unknown token name");
      continue;
    }
    if (seen.has(token.name)) {
      reject(name, "invalid_input: duplicate token alias");
      continue;
    }
    seen.add(token.name);
    const color = HEX_COLOR.test(token.light);
    const allowed = allowedValues(token);
    if (!color && !allowed) {
      reject(name, "invalid_input: token is not editable");
      continue;
    }
    if (isRecord(value) && token.dark !== undefined) {
      for (const key of Object.keys(value)) {
        if (key !== "light" && key !== "dark") {
          reject(`${name}.${key}`, "invalid_input: unknown theme");
        }
      }
    }
    for (const theme of ["light", "dark"] as const) {
      if (isRecord(value) && token.dark !== undefined && !(theme in value)) {
        continue;
      }
      const candidate = isRecord(value) && token.dark !== undefined
        ? value[theme]
        : value;
      if (
        typeof candidate !== "string" ||
        (color ? !HEX_COLOR.test(candidate) : !allowed?.includes(candidate))
      ) {
        reject(
          `${name}.${theme}`,
          "invalid_input: value must match the token kind and allowed steps",
        );
        continue;
      }
      cssVariables[theme][token.name] = candidate;
      changed[theme].add(token.name);
    }
  }
  for (const theme of ["light", "dark"] as const) {
    // 동시 surface·text override도 최종 값으로 검사해야 key 순서가 결과를 바꾸지 않는다.
    const snapshot = { ...cssVariables[theme] };
    for (const name of changed[theme]) {
      const reason = accentReason(name, snapshot);
      if (reason) {
        const token = byName.get(name)!;
        cssVariables[theme][name] = theme === "dark"
          ? token.dark ?? token.light
          : token.light;
        reject(`${name}.${theme}`, `invalid_input: ${reason}`);
      }
    }
  }
  return { cssVariables, rejected };
}
