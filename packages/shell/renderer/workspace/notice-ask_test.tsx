import { assertEquals } from "@std/assert";
import { click, one, render } from "../../../design/components/testing.ts";

import type { AskRequest, AskView } from "./ask-view.ts";
import { NoticeAsk } from "./notice-ask.tsx";
import { NoticeCard } from "./notice-card.tsx";
import { ASK_VIEWS, askView } from "./testdata/ask-agent.ts";

function card(ask: AskView | null, calls: AskRequest[] = []) {
  return render(
    <NoticeCard
      text="Something needs a look"
      actions={<NoticeAsk ask={ask} onAsk={(request) => calls.push(request)} />}
    />,
  );
}

Deno.test("shell/desktop#R35 [agent-I32]: notice card의 actions에 [Ask <agent 이름>]은 ask가 있을 때만 있다", () => {
  for (const ask of ASK_VIEWS) {
    using view = card(ask);
    const button = one(view.container, "[data-action='ask-agent']");
    assertEquals(button.textContent, `Ask ${ask.agentName}`);
    assertEquals(view.container.querySelectorAll("button").length, 1);
  }
  using none = card(null);
  assertEquals(none.container.querySelector("[data-action='ask-agent']"), null);
  assertEquals(none.container.querySelectorAll("button").length, 0);
});

Deno.test("shell/desktop#R35, platform/notifications#R14 [agent-I32]: Ask를 누르면 받은 요청 값을 그대로 한 번 부르고 보내는 것은 없다", () => {
  for (const ask of ASK_VIEWS) {
    const calls: AskRequest[] = [];
    using view = card(ask, calls);
    assertEquals(calls, []);
    click(one(view.container, "[data-action='ask-agent']"));
    assertEquals(calls, [ask.request]);
  }
});

Deno.test("shell/desktop#R35 [agent-I32]: 단추 이름은 ask가 준 agent 이름이다", () => {
  using view = render(
    <NoticeAsk
      ask={askView("app_engineer", "Builder", "release")}
      onAsk={() => {}}
    />,
  );
  assertEquals(
    one(view.container, "[data-action='ask-agent']").textContent,
    "Ask Builder",
  );
});
