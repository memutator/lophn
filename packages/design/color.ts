// 색 계산: hex 읽기·쓰기, WCAG 대비, OKLCH(명도를 옮겨도 색상이 그대로 보이는 공간). theme 검사와 accent 보정이 쓴다.

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

// CSS에 그대로 들어가는 값이라 형식이 곧 injection 경계다. 이 세 형식 밖은 받지 않는다.
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** theme 색으로 받는 값인가: `#rgb`, `#rrggbb`, `#rrggbbaa`. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** accent로 받는 값인가: `#rrggbb`. */
export function isHex6(value: unknown): value is string {
  return typeof value === "string" && HEX6.test(value);
}

/** 0~1 sRGB. alpha는 버린다(대비는 불투명으로 본다). */
export function parseHex(hex: string): Rgb {
  const body = hex.slice(1);
  const full =
    body.length === 3
      ? [...body].map((digit) => digit + digit).join("")
      : body.slice(0, 6);
  const channel = (at: number) =>
    Number.parseInt(full.slice(at, at + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4) };
}

export function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const fromLinear = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 대비 비율(1~21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function toOklch(hex: string): Oklch {
  const { r, g, b } = parseHex(hex);
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

// sRGB 밖이면 색상과 명도는 두고 채도만 줄인다.
function fromOklch(color: Oklch): string {
  const inGamut = (rgb: number[]) =>
    rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let rgb = oklchToLinear(color);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = color.c;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...color, c: mid }))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear({ ...color, c: lo });
  }
  const [r, g, b] = rgb.map(fromLinear) as [number, number, number];
  return toHex({ r, g, b });
}

/** OKLCH 명도를 `by`만큼 옮긴다(+는 밝게). */
export function shiftLightness(hex: string, by: number): string {
  const color = toOklch(hex);
  return fromOklch({ ...color, l: Math.min(1, Math.max(0, color.l + by)) });
}

/**
 * `ok`가 참이 될 때까지 명도를 한 방향으로 조금씩 옮긴다. 끝(검정·흰색)까지 가도 안 되면 끝 값이다.
 * 색상과 채도는 그대로라 고른 색과 같은 색으로 보인다.
 */
export function moveLightness(
  hex: string,
  direction: 1 | -1,
  ok: (candidate: string) => boolean,
): string {
  const color = toOklch(hex);
  for (let step = 0; step <= 100; step += 1) {
    const l = Math.min(1, Math.max(0, color.l + direction * step * 0.01));
    const candidate = fromOklch({ ...color, l });
    // 옮기는 쪽 끝에 닿았을 때만 멈춘다. 시작이 반대쪽 끝(검정에서 밝게)이어도 옮긴다.
    const end = direction < 0 ? l === 0 : l === 1;
    if (ok(candidate) || end) return candidate;
  }
  return hex;
}

/** OKLab에서 섞는다. `t`가 0이면 a, 1이면 b다. */
export function mix(a: string, b: string, t: number): string {
  const x = toOklch(a);
  const y = toOklch(b);
  const ax = x.c * Math.cos(x.h);
  const bx = x.c * Math.sin(x.h);
  const ay = y.c * Math.cos(y.h);
  const by = y.c * Math.sin(y.h);
  const A = ax + (ay - ax) * t;
  const B = bx + (by - bx) * t;
  return fromOklch({
    l: x.l + (y.l - x.l) * t,
    c: Math.hypot(A, B),
    h: Math.atan2(B, A),
  });
}
