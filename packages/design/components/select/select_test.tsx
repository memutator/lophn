import { assert, assertEquals } from "@std/assert";
import { Field } from "../field/field.tsx";
import { Select } from "./select.tsx";
import { focus, isFocused, one, pressAsync, render } from "../testing.ts";

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

function listbox(): Element | null {
  return document.querySelector("[role=listbox]");
}

Deno.test("shell/design-system#R2: Select를 Escape로 닫으면 focus가 연 trigger로 돌아간다", async () => {
  using view = render(
    <Field label="Sort">
      <Select options={options} defaultValue="a" />
    </Field>,
  );
  const trigger = one(view.container, "button");
  focus(trigger);
  await pressAsync(trigger, "Enter");
  assert(listbox(), "listbox did not open");
  assert(!isFocused(trigger), "focus stayed on the trigger");
  await pressAsync(document.activeElement!, "Escape");
  assertEquals(listbox(), null);
  assert(isFocused(trigger), "focus did not return to the trigger");
});

Deno.test("shell/design-system#R43: Select는 Radix 키보드로 골라 값을 바꾸고 trigger로 focus를 돌린다", async () => {
  const chosen: string[] = [];
  using view = render(
    <Field label="Sort">
      <Select
        options={options}
        defaultValue="a"
        onValueChange={(value) => chosen.push(value)}
      />
    </Field>,
  );
  const trigger = one(view.container, "button");
  focus(trigger);
  await pressAsync(trigger, "ArrowDown");
  await pressAsync(document.activeElement!, "ArrowDown");
  await pressAsync(document.activeElement!, "Enter");
  assertEquals(chosen, ["b"]);
  assertEquals(listbox(), null);
  assertEquals(trigger.textContent, "Beta");
  assert(isFocused(trigger), "focus did not return to the trigger");
});

Deno.test("shell/design-system#R28: Select는 Field 라벨로 이름을 받고 placeholder는 값 자리에만 둔다", () => {
  using view = render(
    <Field label="Sort" help="Pick an order.">
      <Select options={options} placeholder="Choose" />
    </Field>,
  );
  const label = one(view.container, "label");
  const trigger = one(view.container, "button");
  assertEquals(label.getAttribute("for"), trigger.id);
  assertEquals(label.textContent, "Sort");
  assertEquals(trigger.textContent, "Choose");
  assert(trigger.hasAttribute("data-placeholder"));
});
