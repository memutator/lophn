import { assertEquals } from "@std/assert";
import { one, render, style } from "../../design/components/testing.ts";
import * as design from "@lophn/design/components";
import * as sdk from "./mod.ts";
import { ControlSizes } from "./examples/control-sizes.tsx";

Deno.test("apps/sdk#R21: @lophn/ui-control는 lophn 화면과 같은 component를 낸다", () => {
  for (
    const name of ["Button", "Input", "Select", "Checkbox", "Switch", "Kbd"]
  ) {
    assertEquals(
      sdk[name as keyof typeof sdk],
      design[name as keyof typeof design],
    );
  }
});

Deno.test("apps/sdk#R14: 예제는 버튼·입력·선택·체크박스·스위치를 28·32·36px 세 크기로 쓰고 키 표시를 둔다", () => {
  using view = render(<ControlSizes />);
  const heights = { sm: "28px", md: "32px", lg: "36px" } as const;
  for (const [size, height] of Object.entries(heights)) {
    const row = one(view.container, `[data-row=${size}]`);
    for (const selector of ["button[data-variant]", "input", "[role=combobox]"]) {
      const control = one(row, selector);
      assertEquals(control.dataset.size, size, selector);
      assertEquals(style(control).height, height, selector);
    }
    const toggles = row.querySelectorAll("div[data-size]");
    assertEquals(toggles.length, 2);
    for (const toggle of toggles) {
      assertEquals(style(toggle).minHeight, height);
    }
    assertEquals(one(row, "kbd").textContent, "CtrlK");
  }
});
