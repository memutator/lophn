// 컴포넌트 원본의 CSS·import를 읽어 금지 표현과 재료(CSS Modules·Radix·Lucide)를 검사한다.
import { assert, assertEquals } from "@std/assert";
import postcss from "postcss";

const here = new URL("./", import.meta.url);

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

function relative(url: URL): string {
  return url.href.slice(here.href.length);
}

const SPACING = /^(margin|padding|gap|row-gap|column-gap)(-|$)/;
// 요소 안 4~8·같은 무리 8~12·무리 16~24 리듬 안의 space와 컨트롤·field·탭 token만 쓴다.
const RHYTHM =
  /^var\(--(space-[0-8]|control-(gap|(sm|md|lg)-pad-x)|field-gap|tab-content-gap)\)$/;

Deno.test("shell/design-system#R6: 컴포넌트 CSS에 그라데이션·glass·그림자·대문자·장식 움직임이 없다", async () => {
  const files = await sources(here, [".css"]);
  assert(files.length >= 10);
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
          ["select/select.module.css", "var(--shadow-popover)"],
        );
      }
      if (decl.prop.startsWith("animation")) {
        assertEquals(name, "skeleton/skeleton.module.css", where);
        assert(decl.value.includes("var(--motion-pulse)"), where);
      }
    });
    root.walkAtRules("keyframes", (rule) => {
      assertEquals([name, rule.params], [
        "skeleton/skeleton.module.css",
        "pulse",
      ]);
    });
  }
});

Deno.test("shell/design-system#R6: 컴포넌트 간격은 정한 리듬 token만 쓴다", async () => {
  for (const file of await sources(here, [".css"])) {
    postcss.parse(await Deno.readTextFile(file)).walkDecls((decl) => {
      if (!SPACING.test(decl.prop)) return;
      for (const part of decl.value.split(/\s+/)) {
        assert(
          RHYTHM.test(part),
          `${relative(file)}: ${decl.prop}: ${decl.value}`,
        );
      }
    });
  }
});

const ALLOWED_IMPORT =
  /^(react|react-dom\/client|lucide-react|@radix-ui\/react-[a-z-]+|@lophn\/wording|\.{1,2}\/.+)$/;
const FORBIDDEN_ICONS =
  /\b(Sparkles?|WandSparkles|Stars?|Loader(Circle|Pinwheel)?|PartyPopper)\b/;

Deno.test("shell/design-system#R43: 컴포넌트 재료는 CSS Modules·Radix Primitives·Lucide뿐이다", async () => {
  const files = await sources(here, [".ts", ".tsx"]);
  for (const file of files) {
    const name = relative(file);
    if (/_test\.tsx?$/.test(name)) continue;
    const source = await Deno.readTextFile(file);
    for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
      assert(ALLOWED_IMPORT.test(match[1]), `${name}: ${match[1]}`);
      if (match[1].endsWith(".css")) {
        assert(match[1].endsWith(".module.css"), `${name}: ${match[1]}`);
      }
    }
    assert(!FORBIDDEN_ICONS.test(source), `${name}: decorative icon`);
    assert(!/\bstyle=\{/.test(source), `${name}: inline style`);
    assert(!/\p{Extended_Pictographic}/u.test(source), `${name}: emoji`);
  }
});
