import { assert, assertEquals } from "@std/assert";
import { tokenNames } from "./generated/vars.ts";
import { applyThemeOverride } from "./theme.ts";
import { tokens } from "./tokens.ts";

Deno.test("shell/design-system#R3: shell·앱은 같은 light·dark CSS 변수 집합을 받는다", () => {
  const theme = applyThemeOverride({
    "--color-text-primary": { light: "#222222", dark: "#eeeeee" },
    "space.4": "12px",
  });
  assertEquals(theme.rejected, []);
  for (const mode of ["light", "dark"] as const) {
    assertEquals(Object.keys(theme.cssVariables[mode]), [...tokenNames]);
    assertEquals(theme.cssVariables[mode]["--space-4"], "12px");
    assertEquals(
      theme.cssVariables[mode]["--shadow-popover"],
      tokens.shadow.popover[mode],
    );
  }
  assertEquals(theme.cssVariables.light["--color-text-primary"], "#222222");
  assertEquals(theme.cssVariables.dark["--color-text-primary"], "#eeeeee");
  assertEquals(applyThemeOverride({}).cssVariables.light["--space-4"], "8px");
});

Deno.test("shell/design-system#R4: 추가·삭제와 잘못된 값만 fallback된다", () => {
  const theme = applyThemeOverride({
    "--unknown": "4px",
    "--color-text-primary": { light: "#xyzxyz", dark: "#eeeeee" },
    "--space-4": null,
    "--radius-md": "6px",
    "--motion-duration-short": "180ms",
    "--font-weight-medium": "600",
    "--status-good-icon": "x",
  });
  assertEquals(
    theme.cssVariables.light["--color-text-primary"],
    tokens.color.text.primary.light,
  );
  assertEquals(theme.cssVariables.dark["--color-text-primary"], "#eeeeee");
  assertEquals(theme.cssVariables.light["--space-4"], "8px");
  assertEquals(theme.cssVariables.light["--radius-md"], "6px");
  assertEquals(theme.cssVariables.dark["--motion-duration-short"], "180ms");
  assertEquals(theme.cssVariables.light["--font-weight-medium"], "600");
  assert(!("--unknown" in theme.cssVariables.light));
  assert(theme.rejected.some((item) => item.name === "--unknown"));
  assert(theme.rejected.some((item) => item.name === "--status-good-icon"));
  assertEquals(theme.cssVariables.light["--space-0"], "0px");
});

Deno.test("shell/design-system#R4: token 종류별 단계와 입력 모양을 검사한다", () => {
  for (const override of [null, [], "theme", 1]) {
    assertEquals(applyThemeOverride(override).rejected.length, 1);
  }
  const defaults = applyThemeOverride({}).cssVariables;
  for (
    const [name, value] of Object.entries({
      "--space-4": "3px",
      "--radius-md": "16px",
      "--border-width": "2px",
      "--type-body-size": "15px",
      "--type-body-line": "18px",
      "--motion-duration-short": "1600ms",
      "--motion-fade": "180ms",
      "--motion-pulse": "120ms",
      "--font-weight-medium": "700",
      "--color-text-primary": "rgb(1,2,3)",
    })
  ) {
    const theme = applyThemeOverride({ [name]: value });
    assertEquals(theme.cssVariables, defaults);
    assert(theme.rejected.length > 0, name);
  }
  const partial = applyThemeOverride({
    "color.text.primary": { dark: "#eeeeee", extra: "#222222" },
  });
  assertEquals(
    partial.cssVariables.light["--color-text-primary"],
    tokens.color.text.primary.light,
  );
  assertEquals(partial.cssVariables.dark["--color-text-primary"], "#eeeeee");
  assert(partial.rejected.some((item) => item.name.endsWith(".extra")));
  assert(
    applyThemeOverride({ "--space-4": "4px", "space.4": "6px" }).rejected.some((
      item,
    ) => item.reason.includes("duplicate")),
  );
});

Deno.test("shell/design-system#R44: 강조색은 hex와 최종 text·surface 대비를 검사한다", () => {
  const defaults = applyThemeOverride({}).cssVariables;
  for (
    const [name, value] of Object.entries({
      "--color-link": { light: "#ffffff", dark: "#161615" },
      "--color-focus": { light: "#ffffff", dark: "#161615" },
      "--color-ink-background": { light: "#ffffff", dark: "#161615" },
      "--color-ink-hover": { light: "#ffffff", dark: "#161615" },
      "--color-selection": { light: "#1a1a18", dark: "#f3f3f0" },
    })
  ) {
    const theme = applyThemeOverride({ [name]: value, "--space-4": "12px" });
    assertEquals(theme.cssVariables.light[name], defaults.light[name]);
    assertEquals(theme.cssVariables.dark[name], defaults.dark[name]);
    assertEquals(theme.cssVariables.light["--space-4"], "12px");
    assertEquals(theme.rejected.length, 2);
  }
  const valid = applyThemeOverride({
    "--color-link": { light: "#000000", dark: "#ffffff" },
  });
  assertEquals(valid.rejected, []);
  const paired = {
    "--color-link": { light: "#000000" },
    "--color-surface-base": { light: "#000000" },
  };
  const result = applyThemeOverride(paired);
  assertEquals(
    result.cssVariables.light["--color-link"],
    defaults.light["--color-link"],
  );
  assertEquals(
    result,
    applyThemeOverride(Object.fromEntries(Object.entries(paired).reverse())),
  );
  assert(applyThemeOverride({ "--color-link": "#fff" }).rejected.length > 0);
});
