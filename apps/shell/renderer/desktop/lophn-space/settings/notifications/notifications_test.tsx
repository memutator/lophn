// settings의 OS notification 자리 화면 테스트(shell#T58). opt-in 설정 값의 저장(켜기·끄기)과
// 실제 OS notification을 보내지 않음을 가짜 통로로 확인한다(platform/notifications#R9).
import { assert, assertEquals } from "@std/assert";
import {
  click,
  render,
} from "../../../../../../../packages/design/components/testing.ts";

import { NotificationsPanel } from "./notifications-panel.tsx";
import { fakeNotifications } from "./testdata/fake-source.ts";
import { find, flush } from "../../testdata/dom.ts";

function textOf(root: Element): string {
  return root.textContent ?? "";
}

Deno.test("flow update-lophn: OS notification opt-in은 켜면 apply를 저장하고 끄면 같은 key를 끈다. 실제 OS notification은 보내지 않는다", async () => {
  const { source, calls } = fakeNotifications({ enabled: false });
  using view = render(<NotificationsPanel source={source} />);
  await flush();
  const row = find(view.container, "[data-notifications-row]");
  assert(textOf(row).includes("System notifications"));
  // 라벨을 클릭하면 같은 switch가 바뀐다. 이 화면의 switch 하나뿐이다.
  click(find(row, "button"));
  await flush();
  assertEquals(calls.find((call) => call[0] === "set"), [
    "set",
    true,
    3,
    "d1",
  ]);
  assertEquals(
    find(view.container, "[data-notice='saved']").textContent,
    "Saved. Notifications follow this choice.",
  );
  // 실제 OS notification은 이 화면이 보내지 않는다: 부른 것은 apply 하나다.
  assertEquals(
    calls.filter((call) => call[0] !== "set" && call[0] !== "notifications")
      .length,
    0,
  );
});

Deno.test("flow update-lophn: 저장에 실패하면 그대로라고 말하고, 다른 곳에서 바뀌었으면 최신을 다시 읽는다", async () => {
  const failed = fakeNotifications({ enabled: false, setCode: "unavailable" });
  using view = render(<NotificationsPanel source={failed.source} />);
  await flush();
  click(find(view.container, "[data-notifications-row] button"));
  await flush();
  assertEquals(
    find(view.container, "[data-notice='failed']").textContent,
    "The choice wasn't saved. Nothing changed. Try again.",
  );

  const stale = fakeNotifications({ enabled: false, setCode: "conflict" });
  using second = render(<NotificationsPanel source={stale.source} />);
  await flush();
  click(find(second.container, "[data-notifications-row] button"));
  await flush();
  assertEquals(
    find(second.container, "[data-notice='stale']").textContent,
    "This changed somewhere else. The latest is shown. Try again.",
  );
});

Deno.test("flow update-lophn: 읽지 못한 자리는 대상과 다시 시도를 보인다", async () => {
  const failed = fakeNotifications({ readFail: true });
  using view = render(<NotificationsPanel source={failed.source} />);
  await flush();
  const state = view.container.querySelector("[data-state='error']");
  assert(state !== null);
  assert(
    (state.querySelector("p")?.textContent ?? "").includes(
      "notification settings",
    ),
  );
  assert(state.querySelector("button"));
});
