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

export function flatten(source: unknown = tokens): FlatToken[] {
  const flat: FlatToken[] = [];
  const walk = (value: unknown, path: string[]) => {
    const name = `--${path.map(segment).join("-")}`;
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
