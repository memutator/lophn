// OS에 설치된 글꼴을 Chromium Local Font Access(`queryLocalFonts`)로 읽어 family와 굵기로 묶는다.
// 권한은 desktop 창의 session이 준다. 읽지 못하면(권한 거절, API 없음) 빈 목록이다.
import { isFontName } from "@lophn/ui";

import type { InstalledFont } from "./source.ts";

/** `queryLocalFonts`가 돌려주는 FontData에서 쓰는 field. */
interface LocalFont {
  readonly family: string;
  readonly style: string;
  readonly postscriptName: string;
}

export type QueryLocalFonts = () => Promise<readonly LocalFont[]>;

// style 이름의 굵기 낱말. 긴 이름을 먼저 본다("ExtraBold"가 "Bold"로 읽히지 않게).
const WEIGHT_WORDS: readonly (readonly [RegExp, string])[] = [
  [/(extra|ultra)\s*light/i, "200"],
  [/(semi|demi)\s*bold/i, "600"],
  [/(extra|ultra)\s*bold/i, "800"],
  [/thin|hairline/i, "100"],
  [/light/i, "300"],
  [/medium/i, "500"],
  [/black|heavy/i, "900"],
  [/bold/i, "700"],
];

/**
 * 글꼴 하나의 굵기. 기울임이면 고르지 않으므로 undefined다. style은 OS 언어로 올 수 있어("굵은", "가는")
 * PostScript 이름의 끝("MaruBuri-Bold"의 Bold)을 같이 본다. 앞부분은 family라서 보지 않는다.
 */
export function weightOf(font: LocalFont): string | undefined {
  const suffix = font.postscriptName.includes("-")
    ? font.postscriptName.slice(font.postscriptName.lastIndexOf("-") + 1)
    : "";
  const words = `${font.style} ${suffix}`;
  if (/italic|oblique/i.test(words)) return undefined;
  return WEIGHT_WORDS.find(([word]) => word.test(words))?.[1] ?? "400";
}

/**
 * 설치된 글꼴을 family 이름 순으로 묶는다. CSS에 넣을 수 없는 이름(isFontName을 어기는 것)은 고를 수 없어 뺀다.
 * 기울임만 있는 family는 Regular 하나로 둔다.
 */
export async function installedFonts(
  query: QueryLocalFonts | undefined,
): Promise<readonly InstalledFont[]> {
  if (query === undefined) return [];
  let fonts: readonly LocalFont[];
  try {
    fonts = await query();
  } catch {
    return [];
  }
  const families = new Map<string, Set<string>>();
  for (const font of fonts) {
    if (!isFontName(font.family)) continue;
    const weights = families.get(font.family) ?? new Set<string>();
    const weight = weightOf(font);
    if (weight !== undefined) weights.add(weight);
    families.set(font.family, weights);
  }
  return [...families]
    .map(([family, weights]) => ({
      family,
      weights: weights.size === 0 ? ["400"] : [...weights].sort(),
    }))
    .sort((a, b) => a.family.localeCompare(b.family));
}
