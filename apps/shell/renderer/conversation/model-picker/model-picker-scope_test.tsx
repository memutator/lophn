// agent-I29: picker가 agent 정의의 model 칸에서 쓰일 때(scope="definition")는 "이 session에만"이 틀린 말이라 정의용
// 설명으로 바뀐다. 기본(session)은 composer의 설명 그대로다(composer test는 model-picker_test가 본다).
import { assertEquals } from "@std/assert";
import {
  one,
  render,
  settle,
  unmountSettled,
} from "../../../../../packages/design/components/testing.ts";

import { ModelPicker } from "./model-picker.tsx";
import { pickerProps } from "../testdata/model-picker.ts";

function scopeNote(): string {
  return one(document, "[data-picker-section=scope]").textContent!.trim();
}

Deno.test("shell/workspace#R41 [agent-I29]: a picker for an agent definition says the model belongs to the agent, not to one session", async () => {
  const view = render(
    <ModelPicker {...pickerProps({ scope: "definition" })} />,
  );
  await settle();
  assertEquals(
    scopeNote(),
    "This agent's model. Clear it to use the project default.",
  );
  await unmountSettled(view);
});

Deno.test("shell/workspace#R41 [agent-I29]: a picker with no scope keeps the session note", async () => {
  const view = render(<ModelPicker {...pickerProps()} />);
  await settle();
  assertEquals(
    scopeNote(),
    "Only this session. Default comes from the agent.",
  );
  await unmountSettled(view);
});
