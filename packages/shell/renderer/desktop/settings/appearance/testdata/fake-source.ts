// Appearance 화면의 가짜 통로. core를 부르지 않고 고른 것을 메모리에 둔다.
import { APPEARANCE_DEFAULTS } from "../model.ts";
import type {
  AppearanceSource,
  AppearanceValues,
  InstalledFont,
} from "../source.ts";

/** 견본 설치 글꼴. 굵기가 여럿인 family와 하나뿐인 family가 섞여 있다. */
export const FAKE_FONTS: readonly InstalledFont[] = [
  { family: "D2Coding", weights: ["400", "700"] },
  { family: "DejaVu Sans", weights: ["200", "400", "700"] },
  { family: "DejaVu Sans Mono", weights: ["400", "700"] },
  { family: "Hack", weights: ["400", "700"] },
  {
    family: "IBM Plex Sans",
    weights: ["100", "200", "300", "400", "500", "600", "700"],
  },
  { family: "MaruBuri", weights: ["200", "300", "400", "600", "700"] },
  { family: "Nanum Gothic", weights: ["400", "700", "800"] },
  { family: "Noto Sans", weights: ["400", "700"] },
  {
    family: "Noto Sans CJK KR",
    weights: ["100", "300", "400", "500", "700", "900"],
  },
  {
    family: "Noto Serif CJK KR",
    weights: ["200", "300", "400", "500", "600", "700", "900"],
  },
  { family: "Sarasa Mono K", weights: ["400", "700"] },
  { family: "Sarasa Term K", weights: ["400", "700"] },
];

interface FakeAppearanceOptions {
  values?: Partial<AppearanceValues>;
  /** 고르기가 거절되는 code. 없으면 저장된다. */
  chooseCode?: string;
  readFails?: boolean;
  /** 설치된 글꼴. 없으면 FAKE_FONTS다. */
  fonts?: readonly InstalledFont[];
}

export function fakeAppearance(options: FakeAppearanceOptions = {}) {
  const calls: unknown[][] = [];
  let values: AppearanceValues = { ...APPEARANCE_DEFAULTS, ...options.values };
  const source: AppearanceSource = {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    values() {
      calls.push(["values"]);
      return Promise.resolve(
        options.readFails
          ? { ok: false, code: "unavailable" }
          : { ok: true, value: values },
      );
    },
    choose(id, value) {
      calls.push(["choose", id, value]);
      if (options.chooseCode) {
        return Promise.resolve({ ok: false, code: options.chooseCode });
      }
      values = { ...values, [id]: value };
      return Promise.resolve({ ok: true, value: null });
    },
    fonts() {
      return Promise.resolve(options.fonts ?? FAKE_FONTS);
    },
  };
  return { source, calls };
}
