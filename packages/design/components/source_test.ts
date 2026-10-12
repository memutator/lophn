// 컴포넌트 원본의 CSS·import를 읽어 금지 표현과 재료(CSS Modules·Radix·Lucide)를 검사한다.
import { assert, assertEquals } from "@std/assert";
import postcss from "postcss";

// 공통 컴포넌트·읽기 renderer·공개 SDK UI도 같은 규칙으로 본다.
const design = new URL("../", import.meta.url);
const packages = new URL("../", design);
const roots = [
  new URL("components/", design),
  new URL("chart/", design),
  new URL("reading/", design),
  new URL("sdk/ui-reading/", packages),
  new URL("sdk/ui-filter/", packages),
  new URL("sdk/ui-stat/", packages),
  new URL("sdk/ui-action/", packages),
  new URL("sdk/ui-control/", packages),
  new URL("sdk/ui-overlay/", packages),
  new URL("sdk/ui-layout/", packages),
  new URL("sdk/ui-state/", packages),
  new URL("sdk/ui-table/", packages),
  new URL("sdk/ui-chart/", packages),
];

async function sources(directory: URL, suffix: string[]): Promise<URL[]> {
  const found: URL[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const url = new URL(
      `${entry.name}${entry.isDirectory ? "/" : ""}`,
      directory,
    );
    if (entry.isDirectory) found.push(...await sources(url, suffix));
    else if (suffix.some((end) => entry.name.endsWith(end))) found.push(url);
  }
  return found.sort((a, b) => a.href.localeCompare(b.href));
}

async function designSources(suffix: string[]): Promise<URL[]> {
  return (await Promise.all(roots.map((root) => sources(root, suffix)))).flat();
}

function relative(url: URL): string {
  return url.href.startsWith(design.href)
    ? url.href.slice(design.href.length)
    : url.href.slice(packages.href.length);
}

const SPACING = /^(margin|padding|gap|row-gap|column-gap)(-|$)/;
// 요소 안 4~8·같은 무리 8~12·무리 16~24 리듬 안의 space와 컨트롤·field·탭 token만 쓴다.
const RHYTHM =
  /^var\(--(space-[0-8]|control-(gap|(sm|md|lg)-pad-x)|field-gap|tab-content-gap)\)$/;
// 섹션 리듬 32~48px(R17)은 페이지 틀과 읽기 본문의 섹션 사이에만 쓴다: 목차 간격 48, 2단 제목 위 40, 구분선 32.
const SECTION = /^var\(--space-(9|10|11)\)$/;
const SECTION_USE = new Set([
  "components/page-frames/page-frames.module.css column-gap",
  "reading/reading.module.css margin-top",
  "reading/reading.module.css margin",
]);
// 칸 여백 16/32px(R24, R42)은 페이지 틀의 padding에만 쓴다.
const PANE = /^var\(--layout-pane-padding-(narrow|wide)\)$/;
const PANE_USE = new Set([
  "components/page-frames/page-frames.module.css padding",
]);

export function rhythmAllowed(
  file: string,
  prop: string,
  part: string,
): boolean {
  if (RHYTHM.test(part)) return true;
  if (SECTION.test(part)) return SECTION_USE.has(`${file} ${prop}`);
  if (PANE.test(part)) return PANE_USE.has(`${file} ${prop}`);
  return part === "auto" && file === "chart/chart.module.css" &&
    prop === "margin-left";
}

// 그림자는 떠 있는 표면만 쓴다. 목록·menu·tooltip·popover·toast·chip은 popover, dialog·sheet·palette는
// dialog 그림자다(R18, R45). 카드와 그 밖의 표면에는 그림자가 없다.
const POPOVER_SHADOW = "var(--shadow-popover)";
const DIALOG_SHADOW = "var(--shadow-dialog)";
const SHADOWS = new Map([
  ["components/select/select.module.css", POPOVER_SHADOW],
  ["components/tooltip/tooltip.module.css", POPOVER_SHADOW],
  ["components/menu/menu.module.css", POPOVER_SHADOW],
  ["components/popover/popover.module.css", POPOVER_SHADOW],
  ["components/toast/toast.module.css", POPOVER_SHADOW],
  ["components/chip/chip.module.css", POPOVER_SHADOW],
  ["components/dialog/dialog.module.css", DIALOG_SHADOW],
  ["components/sheet/sheet.module.css", DIALOG_SHADOW],
  ["components/palette/palette.module.css", DIALOG_SHADOW],
  ["chart/chart.module.css", POPOVER_SHADOW],
]);

Deno.test("shell/design-system#R6: 컴포넌트 CSS에 그라데이션·glass·그림자·대문자·장식 움직임이 없다", async () => {
  const files = await designSources([".css"]);
  assert(files.length >= 16);
  const shadowed = new Set<string>();
  for (const file of files) {
    const name = relative(file);
    const root = postcss.parse(await Deno.readTextFile(file));
    root.walkDecls((decl) => {
      const where = `${name}: ${decl.prop}: ${decl.value}`;
      assert(!/gradient\(/i.test(decl.value), where);
      assert(
        !["backdrop-filter", "filter", "text-shadow", "mix-blend-mode"]
          .includes(decl.prop),
        where,
      );
      if (decl.prop === "text-transform") {
        assert(decl.value !== "uppercase", where);
      }
      if (decl.prop === "box-shadow") {
        assertEquals(decl.value, SHADOWS.get(name), where);
        if (name === "chart/chart.module.css") {
          assertEquals(decl.parent?.type, "rule", where);
          assertEquals(
            (decl.parent as postcss.Rule).selector,
            ".tooltip",
            where,
          );
        }
        shadowed.add(name);
      }
      if (decl.prop.startsWith("animation")) {
        assertEquals(name, "components/skeleton/skeleton.module.css", where);
        assert(decl.value.includes("var(--motion-pulse)"), where);
      }
    });
    root.walkAtRules("keyframes", (rule) => {
      assertEquals([name, rule.params], [
        "components/skeleton/skeleton.module.css",
        "pulse",
      ]);
    });
  }
  assertEquals([...shadowed].sort(), [...SHADOWS.keys()].sort());
});

Deno.test("shell/design-system#R6: 컴포넌트 간격은 정한 리듬 token만 쓴다", async () => {
  for (const file of await designSources([".css"])) {
    const name = relative(file);
    postcss.parse(await Deno.readTextFile(file)).walkDecls((decl) => {
      if (!SPACING.test(decl.prop)) return;
      for (const part of decl.value.split(/\s+/)) {
        assert(
          rhythmAllowed(name, decl.prop, part),
          `${name}: ${decl.prop}: ${decl.value}`,
        );
      }
    });
  }
});

Deno.test("shell/design-system#R17: 섹션 32~48px과 칸 여백은 정한 파일·속성에서만 허용하고 임의 값은 막는다", () => {
  const frames = "components/page-frames/page-frames.module.css";
  const reading = "reading/reading.module.css";
  assert(rhythmAllowed(frames, "column-gap", "var(--space-11)"));
  assert(rhythmAllowed(reading, "margin-top", "var(--space-10)"));
  assert(rhythmAllowed(reading, "margin", "var(--space-9)"));
  assert(rhythmAllowed(frames, "padding", "var(--layout-pane-padding-narrow)"));
  // 다른 파일·다른 속성·리듬 밖 값은 거절한다.
  assert(
    !rhythmAllowed(
      "components/table/table.module.css",
      "margin-top",
      "var(--space-10)",
    ),
  );
  assert(!rhythmAllowed(reading, "padding", "var(--space-11)"));
  assert(!rhythmAllowed(frames, "gap", "var(--space-12)"));
  assert(!rhythmAllowed(reading, "padding", "var(--layout-pane-padding-wide)"));
  assert(!rhythmAllowed(frames, "margin", "auto"));
  assert(!rhythmAllowed(frames, "column-gap", "48px"));
  assert(!rhythmAllowed(reading, "margin-top", "calc(var(--space-10) + 1px)"));
});

const ALLOWED_IMPORT =
  /^(react|react-dom\/client|lucide-react|@radix-ui\/react-[a-z-]+|@lophn\/wording|\.{1,2}\/.+)$/;
const SDK_IMPORT =
  /^@lophn\/(design(\/(components|reading))?|chart|tokens|blueprint|ui-(reading|filter|stat|action|control|overlay|layout|state|table|chart))$/;
// chart package는 design 본체 재료를 공개 이름으로만 가져온다.
const DESIGN_IMPORT = /^@lophn\/design(\/components)?$/;
const PUBLIC_CSS = new Set([
  "@lophn/tokens/base.css",
  "@lophn/tokens/tokens.css",
]);
const PUBLIC_CSS_FILE = "sdk/ui-chart/examples/sales-dashboard.tsx";
// d3는 SVG를 조작하지 않고 정한 계산 모듈에서만 scale·path를 만든다.
const D3_IMPORTS = new Map([
  ["chart/geometry.ts", ["d3-scale"]],
  ["chart/bins.ts", ["d3-scale"]],
  ["chart/bar-plot.tsx", ["d3-scale"]],
  ["chart/line-chart.tsx", ["d3-scale", "d3-shape"]],
  ["chart/graph-layout.ts", ["d3-shape"]],
]);

function importAllowed(file: string, specifier: string): boolean {
  return ALLOWED_IMPORT.test(specifier) ||
    (file.startsWith("sdk/") && SDK_IMPORT.test(specifier)) ||
    (file.startsWith("chart/") && DESIGN_IMPORT.test(specifier)) ||
    (file === PUBLIC_CSS_FILE && PUBLIC_CSS.has(specifier)) ||
    (D3_IMPORTS.get(file)?.includes(specifier) ?? false);
}

Deno.test("shell/design-system#R43: SDK 재료와 공개 CSS는 정한 파일에서만 허용한다", () => {
  assert(importAllowed("chart/geometry.ts", "d3-scale"));
  assert(importAllowed("chart/line-chart.tsx", "d3-shape"));
  assert(importAllowed("sdk/ui-chart/mod.ts", "@lophn/chart"));
  assert(importAllowed("chart/chart-frame.tsx", "@lophn/design/components"));
  assert(importAllowed(PUBLIC_CSS_FILE, "@lophn/tokens/tokens.css"));
  assert(!importAllowed("components/button/button.tsx", "@lophn/ui-chart"));
  assert(!importAllowed("components/data-table/data-table.tsx", "d3-scale"));
  assert(!importAllowed("chart/geometry.ts", "d3-selection"));
  assert(
    !importAllowed("chart/line-chart.tsx", "@lophn/tokens/base.css"),
  );
  assert(!importAllowed(PUBLIC_CSS_FILE, "@lophn/tokens/custom.css"));
  assert(!importAllowed("chart/line-chart.tsx", "@lophn/protocol"));
  assert(
    rhythmAllowed("chart/chart.module.css", "margin-left", "auto"),
  );
  assert(
    !rhythmAllowed("chart/chart.module.css", "padding", "auto"),
  );
});

// Markdown parser는 편집기와 같은 Lezer Markdown 하나이고, 읽기 model 한 파일만 부른다.
const PARSER_IMPORT = "@lezer/markdown";
const PARSER_FILE = "reading/markdown/parse.ts";
// 가상 scroll 자리 높이만 CSSOM으로 쓴다. 값은 행 수 × 행 token이다.
const CSSOM_FILE = "components/table/viewport.ts";
// 장식 아이콘만 막는다. 즐겨찾기 별(`Star`)은 model picker의 기능 단추다(shell/desktop#R44).
const FORBIDDEN_ICONS =
  /\b(Sparkles?|WandSparkles|Stars|Loader(Circle|Pinwheel)?|PartyPopper)\b/;

Deno.test("shell/design-system#R43: 컴포넌트 재료는 CSS Modules·Radix Primitives·Lucide뿐이다", async () => {
  const files = await designSources([".ts", ".tsx"]);
  let parsers = 0;
  for (const file of files) {
    const name = relative(file);
    if (/_test\.tsx?$/.test(name)) continue;
    const source = await Deno.readTextFile(file);
    for (const match of source.matchAll(/(?:from\s+|import\s+)"([^"]+)"/g)) {
      if (match[1] === PARSER_IMPORT) {
        assertEquals(name, PARSER_FILE);
        parsers += 1;
        continue;
      }
      assert(importAllowed(name, match[1]), `${name}: ${match[1]}`);
      if (match[1].endsWith(".css")) {
        assert(
          match[1].endsWith(".module.css") ||
            name === PUBLIC_CSS_FILE && PUBLIC_CSS.has(match[1]),
          `${name}: ${match[1]}`,
        );
      }
    }
    assert(!FORBIDDEN_ICONS.test(source), `${name}: decorative icon`);
    assert(
      !/\beval\s*\(|\bnew\s+Function\s*\(/.test(source),
      `${name}: script`,
    );
    assert(!/\bstyle=\{/.test(source), `${name}: inline style`);
    assert(
      !/dangerouslySetInnerHTML|innerHTML|outerHTML/.test(source),
      `${name}: raw HTML`,
    );
    if (name !== CSSOM_FILE) {
      assert(
        !/\.style\b|setProperty\(|attributeStyleMap/.test(source),
        `${name}: CSSOM`,
      );
    }
    assert(!/\p{Extended_Pictographic}/u.test(source), `${name}: emoji`);
  }
  assertEquals(parsers, 1);
});

Deno.test("shell/design-system#R30: CSSOM 쓰기는 가상 scroll 자리 높이 한 곳이고 token 행 높이만 쓴다", async () => {
  const source = await Deno.readTextFile(new URL(CSSOM_FILE, design));
  const writes = [...source.matchAll(/setProperty\((.*)\);/g)];
  assertEquals(writes.length, 1);
  assertEquals(writes[0][1].trim(), '"height", reservedHeight(rows, density)');
  assert(source.includes("`calc(${rows} * var(--table-row-${density}))`"));
  assert(!/\d+px/.test(source));
});
