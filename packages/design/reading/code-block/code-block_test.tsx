import { assertEquals } from "@std/assert";
import { tokens } from "../../tokens.ts";
import { click, one, render, settle, style } from "../../components/testing.ts";
import { CodeBlock } from "./code-block.tsx";

const code = "<script>alert(1)</script>\nconst a = 1;";

Deno.test("shell/design-system#R39: code block은 mono 글로만 그리고 고정 라벨 key의 복사 버튼을 둔다", async () => {
  const copied: string[] = [];
  using view = render(
    <CodeBlock
      code={code}
      language="html"
      clipboard={{
        writeText: (text) => {
          copied.push(text);
          return Promise.resolve();
        },
      }}
    />,
  );
  const pre = one(view.container, "pre");
  assertEquals(view.container.querySelectorAll("script").length, 0);
  assertEquals(pre.textContent, "<script>alert(1)</script>\nconst a = 1;");
  assertEquals(style(pre).fontFamily, tokens.font.mono);
  assertEquals(style(pre).whiteSpace, "pre");
  const button = one(view.container, "button");
  assertEquals(button.getAttribute("aria-label"), "Copy code");
  click(button);
  await Promise.resolve();
  assertEquals(copied, ["<script>alert(1)</script>\nconst a = 1;"]);
  assertEquals(one(view.container, "figure span").textContent, "html");
});

Deno.test("shell/design-system#R39: code 복사 실패는 중립 문장으로 보이고 같은 버튼으로 다시 시도한다", async () => {
  let attempts = 0;
  const writeText = () =>
    attempts++ === 0 ? Promise.reject(new Error("denied")) : Promise.resolve();
  using view = render(<CodeBlock code={code} clipboard={{ writeText }} />);
  const button = one(view.container, "button[aria-label='Copy code']");
  click(button);
  await settle();
  assertEquals(
    one(view.container, "[role=status]").textContent,
    "Couldn't copy. Try again.",
  );
  click(button);
  await settle();
  assertEquals(view.container.querySelector("[role=status]"), null);
});
