// agent-RW3e: 숨긴 구간. rewind가 숨긴 메시지는 지워지지 않고 thread에서 한 줄로 접혀 보인다. 그 줄이 숨긴 수와
// 실제 복원·건너뜀 결과를 말하고, 펼치면 숨긴 줄을 읽기만 하며, redo를 할 수 있는 동안만 Redo가 있다.
import { assert, assertEquals } from "@std/assert";
import { click, one, render } from "../../../../design/components/testing.ts";

import type { RewindResultView } from "../agent-source.ts";
import { HiddenRange } from "./hidden-range.tsx";

function text(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

const BASE = {
  choice: "restore_all" as const,
  count: 3,
  restored: 2,
  left: [] as readonly RewindResultView[],
  redo: true,
};

function mount(
  over: Partial<Parameters<typeof HiddenRange>[0]> = {},
  redone: string[] = [],
) {
  return render(
    <HiddenRange
      {...BASE}
      revert="rvt_01k6q000000000000000000001"
      onRedo={(revert) => redone.push(revert)}
      {...over}
    >
      <p data-nested="">hidden text</p>
    </HiddenRange>,
  );
}

Deno.test("lophn-agent/revert#R16 [agent-RW3e]: 숨긴 구간은 지우지 않고 한 줄로 접혀 숨긴 메시지 수를 말하고 펼칠 때까지 숨긴 줄을 그리지 않는다", () => {
  using view = mount();
  const row = one(view.container, "[data-hidden-range]");
  assertEquals(
    text(one(row, "[data-hidden-label]")),
    "Rewound here · 3 messages hidden",
  );
  assertEquals(view.container.querySelector("[data-nested]"), null);
  const toggle = one(row, "button[aria-expanded]");
  assertEquals(text(toggle), "Show");
  click(toggle);
  assertEquals(toggle.getAttribute("aria-expanded"), "true");
  assertEquals(text(toggle), "Hide");
  assertEquals(text(one(view.container, "[data-nested]")), "hidden text");
  click(toggle);
  assertEquals(view.container.querySelector("[data-nested]"), null);
});

Deno.test("lophn-agent/revert#R16 [agent-RW3e]: 메시지 하나만 숨겼으면 단수로 쓴다", () => {
  using view = mount({ count: 1 });
  assertEquals(
    text(one(view.container, "[data-hidden-label]")),
    "Rewound here · 1 message hidden",
  );
});

Deno.test("lophn-agent/revert#R3 [agent-RW3e]: 문서까지 되돌렸으면 복원한 수를, 건너뛰거나 남은 것이 있으면 그 수와 목록을 이유와 함께 말한다", () => {
  {
    using view = mount();
    assertEquals(
      text(one(view.container, "[data-hidden-result]")),
      "Restored 2 files.",
    );
    assertEquals(view.container.querySelector("[data-hidden-left]"), null);
  }
  {
    using view = mount({
      restored: 1,
      left: [
        {
          kind: "file",
          target: "notes/b.md",
          result: "skipped",
          reason: "edited_outside",
        },
        {
          kind: "app",
          target: "tcl_01k6q000000000000000000009",
          result: "uncertain",
          reason: "app_uncertain",
        },
      ],
    });
    assertEquals(
      text(one(view.container, "[data-hidden-result]")),
      "Restored 1 file, but 2 items stay as they were.",
    );
    const rows = [...view.container.querySelectorAll("[data-hidden-left] li")]
      .map(text);
    assertEquals(rows, [
      "notes/b.md This file changed after lophn wrote it, so it is left as it is.",
      "An app change The app was asked to undo this, but its answer never arrived. lophn can't tell if it worked.",
    ]);
    assert(!text(view.container).includes("tcl_"));
  }
});

Deno.test("lophn-agent/revert#R1 [agent-RW3e]: 대화만 되돌렸으면 문서 결과 줄이 없다", () => {
  using view = mount({ choice: "messages_only", restored: 0 });
  assertEquals(view.container.querySelector("[data-hidden-result]"), null);
});

Deno.test("lophn-agent/revert#R16 [agent-RW3e]: Redo는 redo를 할 수 있는 동안만 있고 누르면 그 rewind를 인자로 부른다", () => {
  const redone: string[] = [];
  using view = mount({}, redone);
  const button = [...view.container.querySelectorAll("button")].find((item) =>
    text(item) === "Redo"
  )!;
  click(button);
  assertEquals(redone, ["rvt_01k6q000000000000000000001"]);
  view.rerender(
    <HiddenRange
      {...BASE}
      revert="rvt_01k6q000000000000000000001"
      redo={false}
      onRedo={() => {}}
    >
      <p />
    </HiddenRange>,
  );
  assertEquals(
    [...view.container.querySelectorAll("button")].map(text),
    ["Show"],
  );
});
