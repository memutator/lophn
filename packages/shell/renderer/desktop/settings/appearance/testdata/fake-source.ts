// Appearance 화면의 가짜 통로. 값과 theme file은 가짜 core의 설정에 두고 고른 것도 거기 쓴다. 고른 모양은 이 문서에 바로 넣는다(paint.ts).
import { loadThemes, parseAppearance, type ThemeFile } from "@lophn/ui";

import { THEMES_SETTING_KEY } from "../../../../../ipc/appearance.ts";
import { type FakeCore, fakeCore } from "../../testdata/fake-core.ts";
import { APPEARANCE_DEFAULTS, settingKeyOf } from "../model.ts";
import { paintAppearance } from "./paint.ts";
import type {
  AppearanceId,
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
  /** 설치된 글꼴. 없으면 FAKE_FONTS다. */
  fonts?: readonly InstalledFont[];
  /** theme file. 없으면 FAKE_THEME_FILES다. */
  themeFiles?: readonly ThemeFile[];
  /** 값을 둘 가짜 core. 없으면 새로 만든다. */
  core?: FakeCore;
}

/** 견본 theme file. 하나는 내장 theme을 조금 바꾼 것이고, 하나는 대비가 모자라고, 하나는 읽을 수 없다. */
export const FAKE_THEME_FILES: readonly ThemeFile[] = [
  {
    id: "midnight",
    text: JSON.stringify({
      name: "Midnight",
      extends: "tokyo-night",
      colors: { "color.surface.base": "#11121a" },
    }),
  },
  {
    id: "pastel",
    text: JSON.stringify({
      name: "Pastel",
      mode: "light",
      colors: { "color.text.muted": "#b8b8c8", "color.wrong": "#ffffff" },
    }),
  },
  { id: "draft", text: "{ not json" },
];

export function fakeAppearance(options: FakeAppearanceOptions = {}) {
  const calls: unknown[][] = [];
  const core = options.core ?? fakeCore();
  let values: AppearanceValues = { ...APPEARANCE_DEFAULTS, ...options.values };
  const files = options.themeFiles ?? FAKE_THEME_FILES;
  const themes = loadThemes(files);
  for (const [id, value] of Object.entries(values)) {
    core.set(settingKeyOf(id as AppearanceId), value);
  }
  // core는 JSON으로 읽은 file만 항목으로 주고 읽지 못한 file은 이유와 함께 준다.
  core.folder(THEMES_SETTING_KEY, {
    entries: files.flatMap((file) => {
      try {
        return [{ id: file.id, value: JSON.parse(file.text) as unknown }];
      } catch {
        return [];
      }
    }),
    unreadable: files.flatMap((file) => {
      try {
        JSON.parse(file.text);
        return [];
      } catch {
        return [{ name: file.id, reason: "not_json" as const }];
      }
    }),
  });
  const paint = () => {
    const appearance = parseAppearance(values);
    if (appearance !== undefined) paintAppearance(appearance, themes.list);
  };
  paint();
  const source: AppearanceSource = {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    values() {
      calls.push(["values"]);
      return Promise.resolve({ ok: true, value: values });
    },
    choose(id, value) {
      calls.push(["choose", id, value]);
      if (options.chooseCode) {
        return Promise.resolve({ ok: false, code: options.chooseCode });
      }
      values = { ...values, [id]: value };
      core.set(settingKeyOf(id), value);
      core.changed("settings");
      paint();
      return Promise.resolve({ ok: true, value: null });
    },
    fonts() {
      return Promise.resolve(options.fonts ?? FAKE_FONTS);
    },
    openThemesFolder() {
      calls.push(["openThemesFolder"]);
    },
  };
  return { source, calls, core };
}
