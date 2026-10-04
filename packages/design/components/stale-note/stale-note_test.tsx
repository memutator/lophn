import { assertEquals } from "@std/assert";
import { StaleNote } from "./stale-note.tsx";
import { one, render } from "../testing.ts";

const updatedAt = new Date("2026-10-04T09:00:00Z");

Deno.test("shell/design-system#R34: stale은 주입한 지금 시각으로 마지막 갱신 나이를 보인다", () => {
  using view = render(
    <StaleNote
      updatedAt={updatedAt}
      now={new Date("2026-10-04T12:00:00Z")}
    />,
  );
  const note = one(view.container, "[data-state=stale]");
  assertEquals(note.textContent, "Last updated 3 hours ago");
  view.rerender(
    <StaleNote
      updatedAt={updatedAt}
      now={new Date("2026-10-06T09:00:00Z")}
    />,
  );
  assertEquals(note.textContent, "Last updated 2 days ago");
});
