import { assertEquals } from "@std/assert";
import { ToastStack } from "@lophn/design/components";
import {
  click,
  manualTimer,
  one,
  render,
} from "../../../../../packages/design/components/testing.ts";

import type { AskRequest, AskView } from "../../workspace/ask-view.ts";
import {
  ASK_VIEWS,
  askView,
  NOTIFICATION_ID,
} from "../../workspace/testdata/ask-agent.ts";
import { AskAgentToast } from "./ask-agent-toast.tsx";

const TITLE = "Something in your app needs a look";

function open(ask: AskView | null) {
  const log = {
    asked: [] as AskRequest[],
    viewed: [] as string[],
    closed: 0,
  };
  const timer = manualTimer();
  const view = render(
    <ToastStack>
      <AskAgentToast
        notification={NOTIFICATION_ID}
        title={TITLE}
        ask={ask}
        timer={timer}
        clock={timer}
        onAsk={(request) => log.asked.push(request)}
        onView={(id) => log.viewed.push(id)}
        onClose={() => {
          log.closed += 1;
        }}
      />
    </ToastStack>,
  );
  const toast = one(view.container, "[data-tone]");
  const buttons = () =>
    [...toast.querySelectorAll("button")].map((button) =>
      button.textContent || button.getAttribute("aria-label")
    );
  const press = (label: string) =>
    click(
      [...toast.querySelectorAll("button")].find((button) =>
        (button.textContent || button.getAttribute("aria-label")) === label
      )!,
    );
  return { log, view, toast, buttons, press };
}

Deno.test("shell/desktop#R35 [agent-I32]: ask가 있는 toast는 안내 문장 아래 [Ask <agent 이름>] [View]가 이 순서이고 [×]가 뒤에 온다", () => {
  for (const ask of ASK_VIEWS) {
    const { view, toast, buttons } = open(ask);
    using _ = view;
    assertEquals(one(toast, "p").textContent, TITLE);
    assertEquals(buttons(), [`Ask ${ask.agentName}`, "View", "Close"]);
  }
});

Deno.test("shell/desktop#R35 [agent-I32]: ask가 null인 toast는 [View] [×]만 있고 Ask 단추가 없다", () => {
  const { view, toast, buttons } = open(null);
  using _ = view;
  assertEquals(buttons(), ["View", "Close"]);
  assertEquals(toast.textContent?.includes("Ask"), false);
});

Deno.test("shell/desktop#R35, platform/notifications#R14 [agent-I32]: Ask는 받은 요청 값을 싣고 한 번 부른 뒤 닫으며 View는 건드리지 않는다", () => {
  for (const ask of ASK_VIEWS) {
    const { log, view, press } = open(ask);
    using _ = view;
    press(`Ask ${ask.agentName}`);
    assertEquals(log.asked, [ask.request]);
    assertEquals(log.viewed, []);
    assertEquals(log.closed, 1);
  }
});

Deno.test("shell/desktop#R35 [agent-I32]: View는 notification id로 한 번 부르고 닫으며 agent를 부르지 않는다", () => {
  const { log, view, press } = open(ASK_VIEWS[0]!);
  using _ = view;
  press("View");
  assertEquals(log.viewed, [NOTIFICATION_ID]);
  assertEquals(log.asked, []);
  assertEquals(log.closed, 1);
});

Deno.test("shell/desktop#R35 [agent-I32]: [×]는 닫기만 한다", () => {
  const { log, view, press } = open(ASK_VIEWS[0]!);
  using _ = view;
  press("Close");
  assertEquals(log, { asked: [], viewed: [], closed: 1 });
});

Deno.test("shell/desktop#R35 [agent-I32]: 단추 이름은 ask가 준 agent 이름이다", () => {
  const { view, buttons } = open(askView("app_engineer", "Builder", "problem"));
  using _ = view;
  assertEquals(buttons(), ["Ask Builder", "View", "Close"]);
});
