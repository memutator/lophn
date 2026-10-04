import { assert, assertEquals } from "@std/assert";
import { tokens } from "../../tokens.ts";
import { Tab, TabList, TabPanel, Tabs } from "./tabs.tsx";
import { focus, isFocused, pressAsync, render, style } from "../testing.ts";

function view() {
  return render(
    <Tabs defaultValue="overview">
      <TabList>
        <Tab value="overview">Overview</Tab>
        <Tab value="activity">Activity</Tab>
      </TabList>
      <TabPanel value="overview">First</TabPanel>
      <TabPanel value="activity">Second</TabPanel>
    </Tabs>,
  );
}

Deno.test("shell/design-system#R29: 활성 탭은 primary 글자와 2px 밑줄, 비활성은 secondary, 본문은 24px 아래다", () => {
  using rendered = view();
  const [active, inactive] = [
    ...rendered.container.querySelectorAll("[role=tab]"),
  ].map(style);
  assertEquals(active.borderBottomWidth, "2px");
  assertEquals(active.borderBottomColor, tokens.color.text.primary.light);
  assertEquals(active.color, tokens.color.text.primary.light);
  assertEquals(inactive.borderBottomColor, "transparent");
  assertEquals(inactive.color, tokens.color.text.secondary.light);
  const panel = rendered.container.querySelector(
    "[role=tabpanel][data-state=active]",
  )!;
  assertEquals(style(panel).marginTop, "24px");
});

Deno.test("shell/design-system#R43: 탭은 Radix 화살표 키로 옮기고 고른다", async () => {
  using rendered = view();
  const [first, second] = [
    ...rendered.container.querySelectorAll("[role=tab]"),
  ];
  focus(first);
  await pressAsync(first, "ArrowRight");
  assert(isFocused(second), "focus did not move to the next tab");
  assertEquals(second.getAttribute("data-state"), "active");
  assertEquals(
    rendered.container.querySelector("[role=tabpanel][data-state=active]")!
      .textContent,
    "Second",
  );
});
