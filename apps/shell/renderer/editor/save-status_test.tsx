// save-status의 core 끊김 줄(shell/editor#R12, desktop#R7). 저장 불가와 초안 유지는 파일
// 상태와 따로 메타 줄에서 함께 보인다. 파일 상태 headline은 save-state_test가 본다.
// bundle 진입은 editor_test.ts가 이 폴더를 같이 등록한다.
import { assert, assertEquals } from "@std/assert";
import { render } from "../../../../packages/design/components/testing.ts";

import { INITIAL_FACTS } from "./save-state.ts";
import { SaveStatus } from "./save-status.tsx";

function factsOf(over: Record<string, unknown> = {}) {
  return {
    ...INITIAL_FACTS,
    dirty: true,
    pipeline: "waiting" as const,
    disk: { state: "saved" as const, at: 1_000 },
    ...over,
  };
}

Deno.test("shell/editor#R12: core가 끊기면 저장 불가와 초안 유지를 메타 줄에서 함께 보인다", () => {
  using view = render(
    <SaveStatus
      facts={factsOf()}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onAction={() => {}}
      connection={{ state: "stale", confirmedAt: 1_700_000_000_000 }}
      formatTime={(confirmedAt) => `at ${confirmedAt}`}
    />,
  );
  const status = view.container.querySelector(
    "[data-save-status]",
  ) as HTMLElement;
  assert(status, "the stale line is missing");
  assertEquals(status.getAttribute("data-save-status"), "stale");
  assertEquals(status.getAttribute("data-tone"), "warning");
  assert(
    status.textContent?.includes("Not connected. Your changes are kept here."),
    `save is not shown as unavailable while the draft is kept: ${status.textContent}`,
  );
  assert(
    status.textContent?.includes("at 1700000000000"),
    "the last confirmed time is missing",
  );
  assertEquals(status.querySelectorAll("[data-save-action]").length, 0);
});

Deno.test("shell/desktop#R7: core 끊김에서 파일 저장이 끝난 상태여도 끊김 줄은 남는다", () => {
  using view = render(
    <SaveStatus
      facts={INITIAL_FACTS}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onAction={() => {}}
      connection={{ state: "stale", confirmedAt: null }}
    />,
  );
  const status = view.container.querySelector(
    "[data-save-status]",
  ) as HTMLElement;
  assert(status, "the stale line is missing without a file state");
  assertEquals(status.getAttribute("data-save-status"), "stale");
  assert(
    status.textContent?.includes("Not connected. Your changes are kept here."),
  );
  assertEquals(
    status.textContent?.includes("Last checked"),
    false,
    "a null confirmed time is shown as a time",
  );
});

Deno.test("shell/editor#R12: core가 살아 있으면 지금 headline만 보인다", () => {
  using view = render(
    <SaveStatus
      facts={factsOf()}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onAction={() => {}}
      connection={{ state: "ready", confirmedAt: 1 }}
    />,
  );
  const status = view.container.querySelector(
    "[data-save-status]",
  ) as HTMLElement;
  assertEquals(status.getAttribute("data-save-status"), "saving");
  assertEquals(status.textContent?.includes("Not connected."), false);
});
