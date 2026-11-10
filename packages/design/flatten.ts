import { type Themed, tokens } from "./tokens.ts";

export interface FlatToken {
  readonly name: string;
  readonly path: readonly string[];
  readonly light: string;
  readonly dark?: string;
}

function isThemed(value: object): value is Themed {
  return "light" in value && "dark" in value;
}

function segment(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** token 경로의 CSS 변수 이름(`["color", "surface", "base"]` → `--color-surface-base`). */
export function tokenVar(path: readonly string[]): string {
  return `--${path.map(segment).join("-")}`;
}

export function flatten(source: unknown = tokens): FlatToken[] {
  const flat: FlatToken[] = [];
  const walk = (value: unknown, path: string[]) => {
    const name = tokenVar(path);
    if (typeof value === "string" || typeof value === "number") {
      flat.push({ name, path, light: String(value) });
    } else if (typeof value === "object" && value !== null) {
      if (isThemed(value)) {
        flat.push({ name, path, light: value.light, dark: value.dark });
      } else {
        for (const [key, child] of Object.entries(value)) {
          walk(child, [...path, key]);
        }
      }
    }
  };
  walk(source, []);
  return flat;
}

// token 정의 CSS. generate.ts(tokens.css)와 shell main(artifact 문서)이 같이 쓴다.
export function renderCss(flat: readonly FlatToken[]): string {
  const light = flat.map((token) => `  ${token.name}: ${token.light};`);
  const dark = flat
    .filter((token) => token.dark !== undefined)
    .map((token) => `  ${token.name}: ${token.dark};`);
  return [
    ":root {",
    "  color-scheme: light;",
    ...light,
    "}",
    "",
    '[data-theme="dark"] {',
    "  color-scheme: dark;",
    ...dark,
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    '  :root:not([data-theme="light"]) {',
    "    color-scheme: dark;",
    ...dark.map((line) => `  ${line}`),
    "  }",
    "}",
    "",
  ].join("\n");
}
