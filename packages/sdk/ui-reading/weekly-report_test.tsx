import { assert, assertEquals } from "@std/assert";
import { ResizeSourceProvider } from "@lophn/design/components";
import {
  click,
  manualResize,
  one,
  render,
  settle,
  style,
} from "../../design/components/testing.ts";
import * as reading from "@lophn/design/reading";
import * as sdk from "./mod.ts";
import { REPORT, WeeklyReport } from "./examples/weekly-report.tsx";

Deno.test("apps/sdk#R16: @lophn/ui-reading의 Markdown·code block·목차는 lophn 문서 화면과 같은 component다", () => {
  assertEquals(
    [sdk.Markdown, sdk.CodeBlock, sdk.Toc, sdk.parseMarkdown],
    [reading.Markdown, reading.CodeBlock, reading.Toc, reading.parseMarkdown],
  );
});

Deno.test("apps/sdk#R16: 예제는 Markdown 본문·목차 tree·code block·문서 주소를 보이고 주소를 그대로 복사한다", async () => {
  const copied: string[] = [];
  const clipboard = {
    writeText: (text: string) => {
      copied.push(text);
      return Promise.resolve();
    },
  };
  const resize = manualResize();
  using view = render(
    <ResizeSourceProvider value={resize}>
      <WeeklyReport clipboard={clipboard} />
    </ResizeSourceProvider>,
  );
  resize.resize({ width: 1200, height: 800 });

  const address = one(view.container, "[data-address]");
  assertEquals(one(address, "code").textContent, REPORT.address);
  assertEquals(style(one(address, "code")).fontFamily.includes("Mono"), true);
  click(one(address, "button[aria-label='Copy address']"));
  await settle();
  assertEquals(copied, [REPORT.address]);

  const toc = one(view.container, "nav[data-placement=side]");
  const rows = [...toc.querySelectorAll("li")].map((row) => [
    row.textContent,
    (row as HTMLElement).dataset.level,
  ]);
  assertEquals(rows, [
    ["Summary", "2"],
    ["Late shipments", "2"],
    ["How to check one", "3"],
    ["Next week", "2"],
  ]);

  const article = one(view.container, "article");
  assertEquals(one(article, "h2").textContent, "Summary");
  assertEquals(one(article, "strong").textContent, "12%");
  assertEquals(one(article, "pre code").textContent, "orders show A-1001");
  assert(article.querySelector("figure button[aria-label='Copy code']"));

  click([...toc.querySelectorAll("button")][2]);
  assertEquals(
    one(toc, "[aria-current=location]").textContent,
    "How to check one",
  );
});
