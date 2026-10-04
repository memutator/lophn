import { assertEquals } from "@std/assert";
import { tokens } from "../../tokens.ts";
import { Chip, type ChipProps } from "./chip.tsx";
import { click, one, render, settle, style } from "../testing.ts";

const waiting = [
  { id: "q1", title: "<b>Pick a folder</b>" },
  { id: "q2", title: "Approve the change" },
  { id: "q3", title: "Choose a name" },
];

Deno.test("shell/design-system#R35: 기다리는 질문 3건은 360px chip 하나와 나머지 2건 개수로 보인다", () => {
  using view = render(
    <Chip items={waiting} onView={() => {}} onDismiss={() => {}} />,
  );
  const chip = view.container.firstElementChild as HTMLElement;
  assertEquals(style(chip).width, tokens.chip.width);
  assertEquals(one(chip, "p").textContent, "<b>Pick a folder</b>");
  assertEquals(chip.querySelectorAll("b").length, 0);
  assertEquals(chip.textContent?.includes("+2 more"), true);
  assertEquals(chip.textContent?.includes("Approve"), false);
});

Deno.test("shell/design-system#R35: chip은 저절로 사라지지 않고 보기·닫기로만 첫 질문을 넘긴다", async () => {
  const viewed: string[] = [];
  const dismissed: string[] = [];
  using view = render(
    <Chip
      items={waiting.slice(0, 1)}
      onView={(id) => viewed.push(id)}
      onDismiss={(id) => dismissed.push(id)}
    />,
  );
  await settle();
  const chip = view.container.firstElementChild as HTMLElement;
  assertEquals(chip.textContent?.includes("more"), false);
  const [viewButton, close] = chip.querySelectorAll("button");
  assertEquals(viewButton.textContent, "View");
  assertEquals(close.getAttribute("aria-label"), "Close");
  assertEquals(dismissed, []);
  click(viewButton);
  click(close);
  assertEquals(viewed, ["q1"]);
  assertEquals(dismissed, ["q1"]);
  assertEquals(view.container.firstElementChild === chip, true);
  // chip은 시간 제한을 받지 않는다.
  const noTimer: "timer" extends keyof ChipProps ? never : true = true;
  assertEquals(noTimer, true);
});
