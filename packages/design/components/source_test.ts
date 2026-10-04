// 컴포넌트 원본의 CSS·import를 읽어 금지 표현과 재료(CSS Modules·Radix·Lucide)를 검사한다.
import { assert, assertEquals } from "@std/assert";
import postcss from "postcss";

// 공통 컴포넌트와 읽기 renderer를 같은 규칙으로 본다.
const design = new URL("../", import.meta.url);
const roots = [new URL("components/", design), new URL("reading/", design)];

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
  return url.href.slice(design.href.length);
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
  return false;
}

Deno.test("shell/design-system#R6: 컴포넌트 CSS에 그라데이션·glass·그림자·대문자·장식 움직임이 없다", async () => {
  const files = await designSources([".css"]);
  assert(files.length >= 16);
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
        // 그림자는 떠 있는 Select 목록의 popover 그림자만 쓴다(R18).
        assertEquals(
          [name, decl.value],
          ["components/select/select.module.css", "var(--shadow-popover)"],
        );
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
// Markdown parser는 편집기와 같은 Lezer Markdown 하나이고, 읽기 model 한 파일만 부른다.
const PARSER_IMPORT = "@lezer/markdown";
const PARSER_FILE = "reading/markdown/parse.ts";
// 가상 scroll 자리 높이만 CSSOM으로 쓴다. 값은 행 수 × 행 token이다.
const CSSOM_FILE = "components/table/viewport.ts";
const FORBIDDEN_ICONS =
  /\b(Sparkles?|WandSparkles|Stars?|Loader(Circle|Pinwheel)?|PartyPopper)\b/;

Deno.test("shell/design-system#R43: 컴포넌트 재료는 CSS Modules·Radix Primitives·Lucide뿐이다", async () => {
  const files = await designSources([".ts", ".tsx"]);
  let parsers = 0;
  for (const file of files) {
    const name = relative(file);
    if (/_test\.tsx?$/.test(name)) continue;
    const source = await Deno.readTextFile(file);
    for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
      if (match[1] === PARSER_IMPORT) {
        assertEquals(name, PARSER_FILE);
        parsers += 1;
        continue;
      }
      assert(ALLOWED_IMPORT.test(match[1]), `${name}: ${match[1]}`);
      if (match[1].endsWith(".css")) {
        assert(match[1].endsWith(".module.css"), `${name}: ${match[1]}`);
      }
    }
    assert(!FORBIDDEN_ICONS.test(source), `${name}: decorative icon`);
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
