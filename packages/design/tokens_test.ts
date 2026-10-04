import { assert, assertEquals } from "@std/assert";
import { flatten, generate, staleFiles } from "./generate.ts";
import { type Theme, tokens } from "./tokens.ts";

const pair = (light: string, dark: string) => ({ light, dark });

Deno.test("shell/design-system#R7: text 위계는 중립색 세 단계와 disabled로 구별한다", () => {
  assertEquals(Object.keys(tokens.color.text), [
    "primary",
    "secondary",
    "muted",
    "disabled",
  ]);
  for (const theme of ["light", "dark"] as const) {
    assertEquals(
      new Set(Object.values(tokens.color.text).map((value) => value[theme]))
        .size,
      4,
    );
  }
});

Deno.test("shell/design-system#R8: 기본색은 정한 light·dark 쌍이다", () => {
  assertEquals(tokens.color.surface, {
    floor: pair("#f9f9f7", "#0d0d0d"),
    base: pair("#ffffff", "#161615"),
    subtle: pair("#f3f2ef", "#1d1d1b"),
    muted: pair("#ebeae6", "#252523"),
  });
  assertEquals(tokens.color.border, {
    subtle: pair("#e8e7e2", "#232321"),
    base: pair("#e1e0d9", "#2c2c2a"),
    strong: pair("#c3c2b7", "#44443f"),
  });
  assertEquals(tokens.color.text, {
    primary: pair("#1a1a18", "#f3f3f0"),
    secondary: pair("#52514e", "#c3c2b7"),
    muted: pair("#6b6a65", "#96958d"),
    disabled: pair("#a3a29c", "#5f5e59"),
  });
});

Deno.test("shell/design-system#R9: primary는 ink이고 link·focus·selection은 blue다", () => {
  assertEquals(tokens.color.ink.background, tokens.color.text.primary);
  assertEquals(tokens.color.ink.text, tokens.color.surface.base);
  assertEquals(tokens.color.link, pair("#1f66c1", "#6da7ec"));
  assertEquals(tokens.color.focus, pair("#2a78d6", "#3987e5"));
  assertEquals(tokens.color.selection, pair("#e7f0fb", "#16263b"));
});

Deno.test("shell/design-system#R10: status마다 marker·text·icon이 있다", () => {
  assertEquals(tokens.status, {
    good: {
      marker: pair("#0ca30c", "#0ca30c"),
      text: pair("#006300", "#0ca30c"),
      icon: "circle-check",
    },
    warning: {
      marker: pair("#fab219", "#fab219"),
      text: pair("#8a5a00", "#fab219"),
      icon: "triangle-alert",
    },
    serious: {
      marker: pair("#ec835a", "#ec835a"),
      text: pair("#a4461f", "#ec835a"),
      icon: "octagon-alert",
    },
    critical: {
      marker: pair("#d03b3b", "#d03b3b"),
      text: pair("#b93232", "#e66767"),
      icon: "circle-x",
    },
    neutral: {
      marker: pair("#898781", "#898781"),
      text: pair("#52514e", "#c3c2b7"),
      icon: "circle-dashed",
    },
  });
  assertEquals(tokens.status.neutral.text, tokens.color.text.secondary);
});

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)!.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function lowContrastSlots(theme: Theme, surface: string): number[] {
  return tokens.chart.series.flatMap((slot, index) =>
    contrast(slot[theme], surface) < 3 ? [index] : []
  );
}

Deno.test("shell/design-system#R11: chart palette 순서·기타와 낮은 대비 슬롯의 label 또는 table 표시를 검사한다", () => {
  assertEquals(
    tokens.chart.series.map(({ light, dark }) => pair(light, dark)),
    [
      pair("#2a78d6", "#3987e5"),
      pair("#eb6834", "#d95926"),
      pair("#1baf7a", "#199e70"),
      pair("#eda100", "#c98500"),
      pair("#e87ba4", "#d55181"),
      pair("#008300", "#008300"),
      pair("#4a3aa7", "#9085e9"),
      pair("#e34948", "#e66767"),
    ],
  );
  assertEquals(tokens.chart.other, pair("#a3a29c", "#6b6a65"));
  const light = lowContrastSlots("light", "#ffffff");
  assertEquals(light, [2, 3, 4]);
  assertEquals(lowContrastSlots("dark", "#161615"), []);
  assertEquals(
    tokens.chart.series.flatMap((slot, index) =>
      slot.lightNeedsLabelOrTable ? [index] : []
    ),
    light,
  );
});

Deno.test("shell/design-system#R14: diff line·word 색을 두 theme에 제공한다", () => {
  assertEquals(tokens.diff, {
    addLine: pair("#e6f4e4", "#15261a"),
    addWord: pair("#bfe3b9", "#1f4a28"),
    deleteLine: pair("#fbe9e7", "#2d1817"),
    deleteWord: pair("#f4c4bf", "#5c2622"),
  });
});

Deno.test("shell/design-system#R15: font·weight·tabular 값과 로컬 woff2·OFL만 제공한다", async () => {
  assertEquals(tokens.font, {
    sans: '"Pretendard Variable", system-ui, sans-serif',
    mono: '"JetBrains Mono", monospace',
    weight: { regular: 400, medium: 500, semibold: 600 },
    numeric: "tabular-nums",
  });
  const css = await Deno.readTextFile(new URL("./base.css", import.meta.url));
  assert(!/https?:\/\//.test(css));
  assertEquals(css.match(/font-display: swap/g)?.length, 2);
  assertEquals(css.match(/font-weight: 400 600/g)?.length, 2);
  for (const name of ["PretendardVariable", "JetBrainsMonoVariable"]) {
    assert(css.includes(`./fonts/${name}.woff2`));
    const bytes = await Deno.readFile(
      new URL(`./fonts/${name}.woff2`, import.meta.url),
    );
    assertEquals(new TextDecoder().decode(bytes.slice(0, 4)), "wOF2");
  }
  for (const name of ["Pretendard", "JetBrainsMono"]) {
    const license = await Deno.readTextFile(
      new URL(`./fonts/${name}-OFL.txt`, import.meta.url),
    );
    assert(license.includes("SIL OPEN FONT LICENSE"));
  }
});

Deno.test("shell/design-system#R16: type size·line·tracking 값이 요구와 같다", () => {
  assertEquals(tokens.type, {
    caption: { size: "12px", line: "16px" },
    small: { size: "13px", line: "20px" },
    body: { size: "14px", line: "22px" },
    reading: { size: "16px", line: "28px" },
    titleSmall: { size: "16px", line: "24px" },
    title: { size: "20px", line: "28px" },
    display: { size: "28px", line: "36px" },
    tracking: { normal: "0", title: "-0.01em" },
  });
});

Deno.test("shell/design-system#R17: space는 정한 13개 값만 제공한다", () => {
  assertEquals(tokens.space, [
    "0px",
    "2px",
    "4px",
    "6px",
    "8px",
    "12px",
    "16px",
    "20px",
    "24px",
    "32px",
    "40px",
    "48px",
    "64px",
  ]);
});

Deno.test("shell/design-system#R18: radius·border·focus 값이 요구와 같다", () => {
  assertEquals(tokens.radius, {
    xs: "4px",
    sm: "6px",
    md: "8px",
    lg: "12px",
    full: "9999px",
  });
  assertEquals(tokens.border, {
    width: "1px",
    focus: { width: "2px", offset: "2px" },
  });
});

Deno.test("shell/design-system#R19: motion duration·ease·fade·distance·pulse를 고정한다", () => {
  assertEquals(tokens.motion, {
    duration: { short: "120ms", medium: "180ms", long: "240ms" },
    ease: "cubic-bezier(0.2,0,0,1)",
    fade: "120ms",
    distance: "4px",
    pulse: "1600ms",
  });
});

Deno.test("shell/design-system#R20: z 순서를 고정한다", () => {
  assertEquals(tokens.z, {
    base: 0,
    sticky: 10,
    shell: 20,
    sheet: 50,
    backdrop: 200,
    dialog: 210,
    palette: 220,
    popover: 230,
    toast: 300,
    tooltip: 400,
  });
});

Deno.test("shell/design-system#R24: breakpoint·pane padding·sidebar 범위를 고정한다", () => {
  assertEquals(tokens.breakpoint, { sm: 640, md: 1024, lg: 1280 });
  assertEquals(tokens.layout, {
    panePadding: { narrow: "16px", wide: "32px" },
    sidebar: { min: "200px", max: "400px", collapsed: "56px" },
  });
});

Deno.test("shell/design-system#R36: CSS·TS·문서값 generated 불일치를 check와 같은 비교로 잡는다", async () => {
  const outputs = await generate();
  assertEquals(await staleFiles(outputs), []);
  for (const file of Object.keys(outputs)) {
    assertEquals(await staleFiles({ [file]: outputs[file] + "stale" }), [file]);
  }
  assertEquals(JSON.parse(outputs["values.json"]).tokens, tokens);
  const flat = flatten();
  assertEquals(new Set(flat.map((token) => token.name)).size, flat.length);
  for (const token of flat) {
    assert(outputs["tokens.css"].includes(`${token.name}: ${token.light};`));
    assert(outputs["vars.ts"].includes(`var(${token.name})`));
  }
  assert(outputs["vars.ts"].includes("export type TokenName"));
  assert(outputs["tokens.css"].includes('[data-theme="dark"]'));
  assert(outputs["tokens.css"].includes(':root:not([data-theme="light"])'));
  assert(outputs["tokens.css"].includes("@media (prefers-color-scheme: dark)"));
});

Deno.test("shell/design-system#R36: 모든 theme token은 light·dark 쌍이 있고 CSS에 두 값이 있다", async () => {
  const { "tokens.css": css } = await generate();
  const visit = (value: unknown) => {
    if (typeof value !== "object" || value === null) return;
    if ("light" in value || "dark" in value) {
      assert("light" in value && "dark" in value);
      assertEquals(typeof value.light, "string");
      assertEquals(typeof value.dark, "string");
    } else {
      for (const child of Object.values(value)) visit(child);
    }
  };
  visit(tokens);
  const themed = flatten().filter((token) => token.dark !== undefined);
  assert(themed.length > 0);
  for (const token of themed) {
    assert(css.includes(`${token.name}: ${token.dark};`));
  }
});

Deno.test("shell/design-system#R38: floating·backdrop·ink hover 값을 고정한다", () => {
  assertEquals(tokens.floating, {
    surface: pair("#ffffff", "#1d1d1b"),
    hover: pair("#f3f2ef", "#2a2a28"),
    backdrop: pair("rgba(13,13,13,0.4)", "rgba(0,0,0,0.6)"),
  });
  assertEquals(tokens.color.ink.hover, pair("#32322f", "#d9d8d2"));
});

Deno.test("shell/design-system#R45: floating shadow는 popover·dialog 두 개뿐이다", () => {
  assertEquals(tokens.shadow, {
    popover: pair(
      "0 4px 16px rgba(26,26,24,0.08), 0 0 0 1px rgba(26,26,24,0.06)",
      "0 4px 16px rgba(0,0,0,0.32), 0 0 0 1px #2c2c2a",
    ),
    dialog: pair(
      "0 16px 48px rgba(26,26,24,0.16), 0 0 0 1px rgba(26,26,24,0.06)",
      "0 16px 48px rgba(0,0,0,0.48), 0 0 0 1px #2c2c2a",
    ),
  });
});

Deno.test("shell/design-system#R26: 컨트롤 sm·md·lg 높이·좌우 여백·아이콘과 라벨 간격을 고정한다", () => {
  assertEquals(tokens.control, {
    sm: { height: "28px", padX: "8px", icon: "14px" },
    md: { height: "32px", padX: "12px", icon: "16px" },
    lg: { height: "36px", padX: "14px", icon: "16px" },
    gap: "6px",
  });
});

Deno.test("shell/design-system#R43: 아이콘은 16·20px과 정한 14px, 선 1.5다", () => {
  assertEquals(tokens.icon, {
    size: { small: "14px", base: "16px", large: "20px" },
    stroke: 1.5,
  });
});

Deno.test("shell/design-system#R1: 첫 조회 loading 지연은 300ms다", () => {
  assertEquals(tokens.loading, { delay: "300ms" });
});

Deno.test("shell/design-system#R28: 라벨 위·도움말 아래 간격은 6px다", () => {
  assertEquals(tokens.field, { gap: "6px" });
});

Deno.test("shell/design-system#R29: 일반 탭 밑줄은 2px, 본문 간격은 24px다", () => {
  assertEquals(tokens.tab, { indicator: "2px", contentGap: "24px" });
});
