import { assert, assertEquals } from "@std/assert";
import { Trash2 } from "lucide-react";
import { tokens } from "../../tokens.ts";
import { IconButton } from "../icon-button/icon-button.tsx";
import { Button } from "./button.tsx";
import { click, one, render, style } from "../testing.ts";

Deno.test("shell/design-system#R26: 버튼 sm·md·lg는 28·32·36px 높이와 8·12·14px 여백, 아이콘 14·16·16px이다", () => {
  using view = render(
    <div>
      <Button size="sm" icon={Trash2}>Sm</Button>
      <Button size="md" icon={Trash2}>Md</Button>
      <Button size="lg" icon={Trash2}>Lg</Button>
    </div>,
  );
  const buttons = [...view.container.querySelectorAll("button")];
  assertEquals(buttons.map((button) => style(button).height), [
    "28px",
    "32px",
    "36px",
  ]);
  assertEquals(buttons.map((button) => style(button).paddingLeft), [
    "8px",
    "12px",
    "14px",
  ]);
  assertEquals(
    buttons.map((button) => one(button, "svg").getAttribute("width")),
    ["14", "16", "16"],
  );
  assertEquals(style(buttons[1]).gap, "6px");
});

Deno.test("shell/design-system#R26: IconButton은 같은 크기 Button과 높이가 같은 정사각이다", () => {
  using view = render(
    <div>
      <IconButton icon={Trash2} label="Remove" size="sm" />
      <IconButton icon={Trash2} label="Remove" size="lg" />
    </div>,
  );
  const [sm, lg] = [...view.container.querySelectorAll("button")];
  assertEquals([style(sm).height, style(sm).width], ["28px", "28px"]);
  assertEquals([style(lg).height, style(lg).width], ["36px", "36px"]);
  assertEquals(sm.getAttribute("aria-label"), "Remove");
});

Deno.test("shell/design-system#R27: primary는 잉크, secondary는 테두리, ghost는 무배경, danger는 위험색이다", () => {
  using view = render(
    <div>
      <Button variant="primary">Save</Button>
      <Button variant="secondary">Cancel</Button>
      <Button variant="ghost">More</Button>
      <Button variant="danger">Delete</Button>
    </div>,
  );
  const [primary, secondary, ghost, danger] = [
    ...view.container.querySelectorAll("button"),
  ].map(style);
  assertEquals(primary.backgroundColor, tokens.color.ink.background.light);
  assertEquals(primary.color, tokens.color.ink.text.light);
  assertEquals(secondary.borderTopColor, tokens.color.border.base.light);
  assertEquals(secondary.backgroundColor, tokens.color.surface.base.light);
  assertEquals(ghost.backgroundColor, "transparent");
  assertEquals(danger.color, tokens.status.critical.text.light);
});

Deno.test("shell/design-system#R27: 버튼은 내용 너비만 쓰고 전체폭 class를 받지 않는다", () => {
  using view = render(
    <form style={{ display: "flex", flexDirection: "column" }}>
      <Button variant="primary">Save</Button>
    </form>,
  );
  const button = one(view.container, "button");
  assertEquals(style(button).width, "fit-content");
  assertEquals(style(button).flexGrow, "0");
  // @ts-expect-error className으로 전체폭이나 임의 모양을 덧씌우지 못한다.
  void <Button className="wide">Save</Button>;
});

Deno.test("shell/design-system#R27: danger는 결정을 스스로 승인하지 않고 클릭을 호출자의 확인 경로로 넘긴다", () => {
  const opened: string[] = [];
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = () => {
    throw new Error("Button must not confirm on its own");
  };
  try {
    using view = render(
      <Button variant="danger" onClick={() => opened.push("confirmation")}>
        Delete
      </Button>,
    );
    click(one(view.container, "button"));
    assertEquals(opened, ["confirmation"]);
  } finally {
    globalThis.confirm = originalConfirm;
  }
});

Deno.test("shell/design-system#R5: 주 행동은 크기가 아니라 색·굵기로 구별한다", () => {
  using view = render(
    <div>
      <Button variant="primary">Save</Button>
      <Button variant="secondary">Cancel</Button>
    </div>,
  );
  const [primary, secondary] = [...view.container.querySelectorAll("button")]
    .map(style);
  assertEquals(primary.fontSize, secondary.fontSize);
  assertEquals(primary.height, secondary.height);
  assertEquals(primary.fontWeight, String(tokens.font.weight.medium));
  assert(primary.backgroundColor !== secondary.backgroundColor);
});
