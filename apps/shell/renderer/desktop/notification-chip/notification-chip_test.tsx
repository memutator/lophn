import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  focus,
  isFocused,
  render,
  style,
} from "../../../../../packages/design/components/testing.ts";
import { tokens } from "../../../../../packages/design/tokens.ts";

import { NotificationChip } from "./notification-chip.tsx";
import { SpaceDecisions, WaitingPill } from "./space-decisions.tsx";
import { Desktop } from "../main.tsx";
import type { CoreSource } from "../connection/connection.ts";
import {
  RequestDrafts,
  RequestsProvider,
} from "../lophn-space/things-to-confirm/context.tsx";
import { fakeSource as fakeLophn } from "../lophn-space/testdata/fake-source.ts";
import { find, flush } from "../lophn-space/testdata/dom.ts";
import {
  approval,
  fakeRequests,
  manualTicks,
  notification,
  question,
} from "../lophn-space/things-to-confirm/testdata/fake-source.ts";

const NOW = Date.parse("2026-10-06T09:00:00Z");

function provide(
  fake: ReturnType<typeof fakeRequests>,
  ticks: ReturnType<typeof manualTicks>,
  children: React.ReactNode,
) {
  return (
    <RequestsProvider
      deps={{
        source: fake.source,
        drafts: new RequestDrafts(),
        ticks: ticks.ticks,
        now: () => NOW,
      }}
    >
      {children}
    </RequestsProvider>
  );
}

function nothingDecided(fake: ReturnType<typeof fakeRequests>): void {
  assertEquals(fake.state.marked, []);
  assertEquals(fake.state.answered, []);
  assertEquals(fake.state.reviewed, []);
}

const THREE = [
  notification(1, "QuestionCreated", "10"),
  notification(2, "ApprovalRequestCreated", "20"),
  notification(3, "ProblemOpened", "30"),
];

Deno.test("shell/desktop#R10, shell/design-system#R35: 3건은 오른쪽 아래 360px chip 하나와 외 2건이다", async () => {
  const fake = fakeRequests({ notifications: [...THREE] });
  using view = render(
    provide(fake, manualTicks(), <NotificationChip onView={() => {}} />),
  );
  await flush();
  const corner = find(view.container, "[data-notification-chip]");
  assertEquals(style(corner).position, "fixed");
  assertEquals(style(corner).right, "16px");
  assertEquals(style(corner).bottom, "16px");
  const chips = corner.querySelectorAll("p");
  assertEquals(chips.length, 1);
  assertEquals(chips[0]!.textContent, "A question is waiting");
  assertEquals(style(corner.firstElementChild!).width, tokens.chip.width);
  assert(corner.textContent?.includes("+2 more"));
  assert(!corner.textContent?.includes("A decision is waiting"));
});

Deno.test("shell/desktop#R10: 보기는 things-to-confirm으로 갈 뿐이고 닫기는 이 창에서 감출 뿐 읽음·결정이 아니다", async () => {
  const fake = fakeRequests({ notifications: [...THREE] });
  let viewed = 0;
  const ticks = manualTicks();
  using view = render(
    provide(fake, ticks, <NotificationChip onView={() => viewed++} />),
  );
  await flush();
  const corner = () => find(view.container, "[data-notification-chip]");
  const [viewButton, close] = corner().querySelectorAll("button");
  assertEquals(viewButton!.textContent, "View");
  click(viewButton!);
  await flush();
  assertEquals(viewed, 1);
  nothingDecided(fake);
  assertEquals(
    corner().querySelector("p")?.textContent,
    "A decision is waiting",
  );
  assertEquals(close!.getAttribute("aria-label"), "Close");
  click(corner().querySelectorAll("button")[1]!);
  await flush();
  assertEquals(
    corner().querySelector("p")?.textContent,
    "An issue was reported",
  );
  nothingDecided(fake);
  // 다시 읽어도 닫은 것은 이 창에 다시 올라오지 않는다. 저절로 사라지지도 않는다.
  ticks.tick();
  await flush();
  assertEquals(
    corner().querySelector("p")?.textContent,
    "An issue was reported",
  );
  assertEquals(
    fake.state.notifications.every((row) => row.readAt === null),
    true,
  );
});

Deno.test("shell/desktop#R10: chip이 저절로 나타나도 입력 focus와 현재 화면을 바꾸지 않는다", async () => {
  const fake = fakeRequests();
  const ticks = manualTicks();
  using view = render(
    provide(
      fake,
      ticks,
      <>
        <textarea data-typing="" />
        <NotificationChip onView={() => {}} />
      </>,
    ),
  );
  await flush();
  assertEquals(view.container.querySelector("[data-notification-chip]"), null);
  const typing = find(view.container, "[data-typing]");
  focus(typing);
  fake.state.notifications = [notification(1, "QuestionCreated", "10")];
  ticks.tick();
  await flush();
  assert(view.container.querySelector("[data-notification-chip]"));
  assert(isFocused(typing), "the chip took the input focus");
});

Deno.test("shell/desktop#R10: chip의 보기는 창을 lophn 공간의 things-to-confirm으로 옮긴다", async () => {
  const fake = fakeRequests({
    requests: [question(1)],
    notifications: [notification(1, "QuestionCreated", "10")],
  });
  const core: CoreSource = {
    subscribe(listener) {
      listener({ state: "ready", confirmedAt: 1 });
      return () => {};
    },
    call: () => Promise.resolve({ ok: true, value: {} }),
  };
  using view = render(
    provide(
      fake,
      manualTicks(),
      <Desktop source={core} lophn={fakeLophn().source} />,
    ),
  );
  await flush();
  assert(view.container.querySelector("[data-space='launcher']"));
  const chip = find(view.container, "[data-notification-chip]");
  click(chip.querySelector("button")!);
  await flush();
  const space = find(view.container, "[data-space='lophn']");
  assertEquals(space.getAttribute("data-current-screen"), "things-to-confirm");
  nothingDecided(fake);
});

Deno.test("shell/desktop#R26: 대기 개수는 색이 아니라 글자 pill로 읽고 0이면 없다", () => {
  using view = render(
    <div>
      <WaitingPill count={2} />
      <WaitingPill count={1} onOpen={() => {}} />
      <WaitingPill count={0} />
    </div>,
  );
  const pills = view.container.querySelectorAll("[data-waiting-pill]");
  assertEquals([...pills].map((pill) => pill.textContent), [
    "2 decisions waiting",
    "1 decision waiting",
  ]);
  assertEquals(pills[0]!.tagName, "SPAN");
  assertEquals(pills[1]!.tagName, "BUTTON");
});

Deno.test("shell/desktop#R27: 공간의 lophn 크롬은 그 공간의 결정 대기와 lophn 장애 안내만 보인다", async () => {
  const project = {
    kind: "project",
    id: "prj_01h455vb4pex5v6nkc6gd5fd01",
  } as const;
  const fake = fakeRequests({
    requests: [
      question(1, { place: project }),
      approval(2, { place: project }),
      approval(3, {
        place: { kind: "project", id: "prj_01h455vb4pex5v6nkc6gd5fd02" },
      }),
      question(4, { place: { kind: "global" } }),
    ],
  });
  let opened = 0;
  using view = render(
    provide(
      fake,
      manualTicks(),
      <SpaceDecisions place={project} onOpen={() => opened++} />,
    ),
  );
  await flush();
  const chrome = find(view.container, "[data-space-decisions]");
  assertEquals(chrome.textContent, "2 decisions waiting");
  click(find(chrome, "[data-waiting-pill]"));
  assertEquals(opened, 1);
  nothingDecided(fake);
  act(() => fake.push({ state: "failed", confirmedAt: 1 }));
  await flush();
  assertEquals(
    find(view.container, "[data-core-down]").textContent,
    "lophn isn't responding.",
  );
});

Deno.test("shell/desktop#R27: 그 공간에 기다리는 결정이 없고 연결이 멀쩡하면 크롬을 두지 않는다", async () => {
  const fake = fakeRequests({
    requests: [question(4, { place: { kind: "global" } })],
  });
  using view = render(
    provide(
      fake,
      manualTicks(),
      <SpaceDecisions
        place={{ kind: "app", id: "app_01h455vb4pex5v6nkc6gd5fd01" }}
        onOpen={() => {}}
      />,
    ),
  );
  await flush();
  assertEquals(view.container.querySelector("[data-space-decisions]"), null);
});
