// start-failure_test: shell#T57 launcher failure screen rendering

import { assert, assertEquals } from "@std/assert";
import {
  click,
  render,
} from "../../../../../../packages/design/components/testing.ts";

import { sandboxFailure, schemaFailure, startFailure } from "./model.ts";
import { StartFailureScreen } from "./start-failure.tsx";

function raw(text: string): void {
  for (const code of ["app-", "retry-start-app", "check-"]) {
    assert(!text.includes(code), `raw code ${code} is visible: ${text}`);
  }
}

Deno.test("shell/desktop#R12, shell/wording#R10: 시작 실패는 사람 말 제목·문장과 다시 시도 하나를 보이고 안쪽 code는 펼친 상세에만 둔다", () => {
  let retried = 0;
  using view = render(
    <StartFailureScreen failure={startFailure()} onRetry={() => retried++} />,
  );
  const text = view.container.textContent ?? "";
  assertEquals(
    view.container.querySelector("h1")?.textContent,
    "lophn didn't start",
  );
  assert(text.includes("couldn't start in the background"));
  raw(text);
  const retry = view.container.querySelector("[data-action='retry']")!;
  assertEquals(retry.textContent, "Try again");
  click(retry);
  assertEquals(retried, 1);

  click(view.container.querySelector("[data-details-toggle]")!);
  assertEquals(
    view.container.querySelector("[data-details]")?.textContent,
    "app-start-failed · retry-start-app",
  );
});

Deno.test("shell/desktop#R12, R20: sandbox 실패와 schema 비호환은 서로 다른 사람 말 제목을 보인다", () => {
  const titles = [sandboxFailure(), schemaFailure()].map((failure) => {
    using view = render(
      <StartFailureScreen failure={failure} onRetry={() => {}} />,
    );
    raw(view.container.textContent ?? "");
    return view.container.querySelector("h1")?.textContent;
  });
  assertEquals(titles, [
    "lophn is blocked by your system",
    "lophn needs an update",
  ]);
});
