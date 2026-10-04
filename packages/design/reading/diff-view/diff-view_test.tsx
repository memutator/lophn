import { assert, assertEquals } from "@std/assert";
import { tokens } from "../../tokens.ts";
import { one, render, style } from "../../components/testing.ts";
import { DiffView } from "./diff-view.tsx";

Deno.test("shell/design-system#R14: diff 줄과 단어는 정한 배경, +/− 기호, primary 글자로 그린다", () => {
  using view = render(
    <DiffView
      lines={[
        { kind: "same", oldNumber: 1, newNumber: 1, text: "Title" },
        {
          kind: "delete",
          oldNumber: 2,
          text: "Budget is 10.",
          spans: [{ text: "Budget is " }, { text: "10", changed: true }, {
            text: ".",
          }],
        },
        {
          kind: "add",
          newNumber: 2,
          text: "Budget is 12.",
          spans: [{ text: "Budget is " }, { text: "12", changed: true }, {
            text: ".",
          }],
        },
      ]}
    />,
  );
  const rows = [
    ...view.container.querySelectorAll("tr"),
  ] as HTMLTableRowElement[];
  assertEquals(rows.map((row) => row.dataset.diff), ["same", "delete", "add"]);
  assertEquals(rows.map((row) => row.cells[2].textContent), ["", "−", "+"]);
  assertEquals(style(rows[1]).backgroundColor, tokens.diff.deleteLine.light);
  assertEquals(style(rows[2]).backgroundColor, tokens.diff.addLine.light);
  const added = one(rows[2], "mark");
  assertEquals(added.textContent, "12");
  assertEquals(style(added).backgroundColor, tokens.diff.addWord.light);
  assertEquals(style(added).color, tokens.color.text.primary.light);
  assertEquals(
    style(one(rows[1], "mark")).backgroundColor,
    tokens.diff.deleteWord.light,
  );
  assertEquals(
    style(view.container.firstElementChild!).color,
    tokens.color.text.primary.light,
  );
  // muted 글자는 줄 배경 위의 줄 번호에만 쓴다.
  assertEquals(style(rows[1].cells[0]).color, tokens.color.text.muted.light);
  assertEquals(rows[0].querySelectorAll("mark").length, 0);
  assert(rows[1].textContent!.includes("Budget is 10."));
});

Deno.test("shell/design-system#R14: 바뀐 줄이 없으면 같은 내용이라는 문장을 보인다", () => {
  using view = render(
    <DiffView
      lines={[{ kind: "same", oldNumber: 1, newNumber: 1, text: "a" }]}
    />,
  );
  assertEquals(view.container.textContent, "These versions are identical.");
  assertEquals(view.container.querySelector("table"), null);
});
