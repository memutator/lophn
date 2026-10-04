import { assert, assertEquals } from "@std/assert";
import { tokens } from "../../tokens.ts";
import { click, one, render, style } from "../../components/testing.ts";
import { Markdown } from "./markdown.tsx";

const light = (value: { light: string }) => value.light;

const headings =
  "# One\n\nBody\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n";

Deno.test("shell/design-system#R39: 제목은 1단 20px, 2단 16px/600/위 40px, 3단 16px/600/secondary, 4단 14px이다", () => {
  using view = render(
    <Markdown source={headings} />,
  );
  const h = (tag: string) => style(one(view.container, tag));
  assertEquals([h("h1").fontSize, h("h1").lineHeight], ["20px", "28px"]);
  // 제목 자간 -0.01em은 20px에서 -0.2px로 계산된다.
  assertEquals(h("h1").letterSpacing, "-0.2px");
  assertEquals(h("h2").letterSpacing, "-0.16px");
  assertEquals(
    [h("h2").fontSize, h("h2").fontWeight, h("h2").marginTop],
    ["16px", "600", "40px"],
  );
  assertEquals(
    [h("h3").fontSize, h("h3").fontWeight, h("h3").color],
    ["16px", "600", light(tokens.color.text.secondary)],
  );
  assertEquals([h("h4").fontSize, h("h5").fontSize], ["14px", "14px"]);
  assertEquals(one(view.container, "h2").id, "two");
  for (const tag of ["h1", "h2", "h3", "h4", "h5"]) {
    assert(Number(h(tag).fontWeight) <= 600, tag);
  }
});

const plain = "Plain *reading* text.\n";

Deno.test("shell/design-system#R16: 읽기 본문은 16/28px이고 자간은 0이다", () => {
  using view = render(<Markdown source={plain} />);
  const root = style(view.container.firstElementChild!);
  assertEquals([root.fontSize, root.lineHeight, root.letterSpacing], [
    "16px",
    "28px",
    "0px",
  ]);
  assertEquals(root.color, light(tokens.color.text.primary));
  assertEquals(one(view.container, "em").textContent, "reading");
});

Deno.test("shell/design-system#R39: raw HTML·위험한 주소는 실행하지 않고 글로 그린다", () => {
  const target = globalThis as { pwned?: boolean };
  delete target.pwned;
  using view = render(
    <Markdown
      source={[
        "<script>globalThis.pwned = true</script>",
        "",
        '<img src=x onerror="globalThis.pwned = true">',
        "",
        "[click](javascript:globalThis.pwned=true) [ok](https://x.io) ![i](javascript:x) ![p](https://x.io/p.png)",
        "",
        '<a href="javascript:x">raw</a> &lt;b&gt;',
      ].join("\n")}
    />,
  );
  const root = view.container.firstElementChild!;
  assertEquals(root.querySelectorAll("script").length, 0);
  const images = [...root.querySelectorAll("img")];
  assertEquals(images.map((image) => image.getAttribute("src")), [
    "https://x.io/p.png",
  ]);
  const anchors = [...root.querySelectorAll("a")];
  assertEquals(anchors.map((anchor) => anchor.getAttribute("href")), [
    "https://x.io",
  ]);
  for (const element of root.querySelectorAll("*")) {
    for (const attribute of element.getAttributeNames()) {
      assert(!attribute.startsWith("on"), `${element.tagName} ${attribute}`);
    }
  }
  assert(
    root.textContent!.includes("<script>globalThis.pwned = true</script>"),
  );
  assert(root.textContent!.includes('<a href="javascript:x">raw</a> <b>'));
  assert(root.textContent!.includes("click"));
  assertEquals(target.pwned, undefined);
});

Deno.test("shell/design-system#R39: link는 호출자가 열고 목록·task·code·표를 React element로 그린다", async () => {
  const opened: string[] = [];
  const copied: string[] = [];
  using view = render(
    <Markdown
      source={[
        "See [guide](https://x.io/guide).",
        "",
        "- [x] done",
        "- [ ] open",
        "",
        "3. three",
        "",
        "```ts",
        "let a = 1;",
        "```",
        "",
        "| Name | Size |",
        "|---|--:|",
        "| a | 12 |",
      ].join("\n")}
      onOpenLink={(href) => opened.push(href)}
      clipboard={{
        writeText: (text) => {
          copied.push(text);
          return Promise.resolve();
        },
      }}
    />,
  );
  click(one(view.container, "a"));
  assertEquals(opened, ["https://x.io/guide"]);
  const tasks = [...view.container.querySelectorAll("[data-task]")];
  assertEquals(tasks.map((task) => task.getAttribute("data-task")), [
    "true",
    "false",
  ]);
  assert(tasks[0].querySelector("svg.lucide-square-check"));
  assertEquals(one(view.container, "ol").getAttribute("start"), "3");
  assertEquals(one(view.container, "pre code").textContent, "let a = 1;");
  click(one(view.container, "button[aria-label='Copy code']"));
  await Promise.resolve();
  assertEquals(copied, ["let a = 1;"]);
  const cells = [...view.container.querySelectorAll("tbody td")];
  assertEquals(style(cells[1]).textAlign, "right");
  assertEquals(style(cells[1]).fontVariantNumeric, "tabular-nums");
});

const taskSource = [
  "- [x] task",
  "",
  "  continuation",
  "",
  "  - [ ] child",
  "",
  '  > quote <img src=x onerror="globalThis.pwned = true">',
  "",
  "  ```",
  "  <script>globalThis.pwned = true</script>",
  "  ```",
].join("\n");

Deno.test("shell/design-system#R39: task 항목 안의 이어지는 문단·하위 task·인용·code가 보이고 HTML은 글이다", () => {
  const target = globalThis as { pwned?: boolean };
  delete target.pwned;
  using view = render(<Markdown source={taskSource} />);
  const outer = one(view.container, "li[data-task=true]");
  const body = outer.lastElementChild!;
  assertEquals(
    [...body.children].map((child) => child.tagName.toLowerCase()),
    ["p", "p", "ul", "blockquote", "figure"],
  );
  assertEquals(body.children[1].textContent, "continuation");
  const child = one(body, "li[data-task=false]");
  assertEquals(child.textContent, "child");
  assert(child.querySelector("svg.lucide-square"));
  assertEquals(
    one(body, "blockquote").textContent,
    'quote <img src=x onerror="globalThis.pwned = true">',
  );
  assertEquals(
    one(body, "pre code").textContent,
    "<script>globalThis.pwned = true</script>",
  );
  assertEquals(view.container.querySelectorAll("img, script").length, 0);
  assertEquals(target.pwned, undefined);
});
