import { assert, assertEquals, assertThrows } from "@std/assert";
import { tokens } from "../../tokens.ts";
import { Input } from "../input/input.tsx";
import { Textarea } from "../textarea/textarea.tsx";
import { Field } from "./field.tsx";
import { one, render, style } from "../testing.ts";

Deno.test("shell/design-system#R28: 라벨은 입력 위, 도움말은 아래에 6px 간격으로 놓인다", () => {
  using view = render(
    <Field label="Project name" help="Shown in the launcher.">
      <Input placeholder="My notes" />
    </Field>,
  );
  const field = one(view.container, "div");
  const [label, input, help] = [...field.children] as HTMLElement[];
  assertEquals(label.tagName, "LABEL");
  assertEquals(input.tagName, "INPUT");
  assertEquals(help.tagName, "P");
  assertEquals(style(field).gap, "6px");
  assertEquals(label.getAttribute("for"), input.id);
  assertEquals(style(label).fontSize, "13px");
  assertEquals(style(label).fontWeight, String(tokens.font.weight.medium));
  assertEquals(style(label).color, tokens.color.text.secondary.light);
  assertEquals(style(help).fontSize, "12px");
});

Deno.test("shell/design-system#R28: placeholder는 라벨을 대신하지 않고 빈 입력도 라벨이 있다", () => {
  using view = render(
    <Field label="Project name">
      <Input placeholder="My notes" />
    </Field>,
  );
  const input = one(view.container, "input") as HTMLInputElement;
  assertEquals(input.value, "");
  assertEquals(one(view.container, "label").textContent, "Project name");
  assert(input.placeholder !== one(view.container, "label").textContent);
  assertThrows(
    () => render(<Input placeholder="Name only" />),
    Error,
    "needs a Field label",
  );
});

Deno.test("shell/design-system#R28: 오류는 도움말을 대신하고 색 없이도 아이콘과 표지로 구별한다", () => {
  using view = render(
    <Field
      label="Project name"
      help="Shown in the launcher."
      error="Enter a name."
    >
      <Textarea />
    </Field>,
  );
  const message = one(view.container, "p");
  assertEquals(message.dataset.tone, "error");
  assertEquals(message.textContent, "Enter a name.");
  assert(one(message, "svg").classList.contains("lucide-circle-x"));
  assertEquals(one(view.container, "textarea").dataset.invalid, "true");
});

Deno.test("shell/design-system#R28: 입력은 표면 배경·strong 테두리·focus 링이다", () => {
  using view = render(
    <Field label="Project name">
      <Input />
    </Field>,
  );
  const input = style(one(view.container, "input"));
  assertEquals(input.backgroundColor, tokens.color.surface.base.light);
  assertEquals(input.borderTopColor, tokens.color.border.strong.light);
  assertEquals(input.borderTopWidth, tokens.border.width);
});
