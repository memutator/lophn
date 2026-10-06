import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  one,
  render,
} from "../../../../../packages/design/components/testing.ts";

import { AppViewsProvider } from "../../app-frame/app-views.tsx";
import {
  fakeAppViews,
  frames,
  withLayout,
} from "../../app-frame/testdata/app-views.ts";
import { IDLE, VisualBlock, type VisualHost } from "./block-frame.tsx";
import { APP, appCardBlock, REL } from "./testdata/blocks.ts";

const MESSAGE = "msg_01h455vb4pex5v6nkc6gd5f001";
const OTHER_REL = "rel_01h455vb4pex5v6nkc6gd5fdw9";

const host: VisualHost = {
  documentTitle: () => Promise.resolve({ ok: false, code: "not_found" }),
  saveState: () => IDLE,
  now: () => new Date("2026-10-06T09:00:00Z"),
};

function cardViews(release: string | null = REL) {
  const fake = fakeAppViews();
  if (release !== null) {
    fake.apps.set(APP, {
      ok: true,
      value: { name: "Orders", release, archived: false },
    });
  }
  return fake;
}

function Card(
  { fake, rect = "0 0 400 600" }: {
    fake: ReturnType<typeof fakeAppViews>;
    rect?: string;
  },
) {
  return (
    <AppViewsProvider value={fake.deps}>
      <div data-rect="0 0 400 300" data-list="" style={{ overflowY: "auto" }}>
        <div data-rect={rect} data-card-slot="">
          <VisualBlock message={MESSAGE} block={appCardBlock} host={host} />
        </div>
      </div>
    </AppViewsProvider>
  );
}

Deno.test("shell/workspace#R12, shell/app-frame#R33, shell/app-frame#R34: 앱 카드는 블록의 앱·고정 판·card 크기와 message·block 참조로 열고 입력은 그리지 않으며 크롬이 그 view에 묶인다", async () => {
  await withLayout(async () => {
    const fake = cardViews();
    using view = render(<Card fake={fake} />);
    await frames();
    assertEquals(fake.opened(), [{
      app: APP,
      mode: "live",
      release: REL,
      screen: "summary",
      size: "card",
      card: { message: MESSAGE, block: "card" },
    }]);
    const root = view.container;
    const card = one(root, `[data-visual-app-card='${APP}']`);
    assertEquals(card.getAttribute("data-app-card-state"), "open");
    // 카드 입력은 앱 view에 넘길 값이라 shell이 글로 그리지 않는다.
    assert(!root.textContent!.includes("7d"));
    const chrome = one(card, "[data-view-chrome]");
    assertEquals(one(chrome, "[data-view-app-name]").textContent, "Orders");
    assertEquals(one(chrome, "[data-view-mode]").textContent, "Live");
    click(one(chrome, "[data-report-problem]"));
    assertEquals(fake.reports, ["view-1"]);
    // 블록 틀의 문서로 남기기와 제목은 앱 view 자리 밖이다.
    const region = one(card, "[data-phase]");
    assert(!region.contains(chrome));
  });
});

Deno.test("shell/app-frame#R35: 카드는 목록 scroll 경계로 자른 보이는 사각형만 보내고 경계 밖이면 숨긴다", async () => {
  await withLayout(async () => {
    const fake = cardViews();
    using view = render(<Card fake={fake} rect="0 250 400 240" />);
    await frames();
    const bounds = fake.calls.filter((call) => call[0] === "bounds");
    assertEquals(bounds.at(-1), [
      "bounds",
      "view-1",
      { x: 0, y: 250, width: 400, height: 50 },
    ]);
    // 목록을 내려 카드가 경계 밖으로 나가면 view를 숨기고 폐기하지 않는다.
    one(view.container, "[data-card-slot]").setAttribute(
      "data-rect",
      "0 320 400 240",
    );
    one(view.container, "[data-list]").dispatchEvent(new Event("scroll"));
    await frames();
    assertEquals(fake.calls.at(-1), ["hide", "view-1"]);
    assertEquals(fake.calls.filter((call) => call[0] === "close"), []);
  });
});

Deno.test("shell/workspace#R12: 앱의 지금 판이 다르면 contract_changed, 앱이 없으면 unavailable로 두고 다른 판으로 열지 않는다", async () => {
  await withLayout(async () => {
    const changed = cardViews(OTHER_REL);
    using first = render(<Card fake={changed} />);
    await frames();
    assertEquals(changed.opened(), []);
    assertEquals(
      one(first.container, "[data-app-card-state]").textContent,
      "This app changed after the card was made, so the card isn't shown.",
    );

    const gone = cardViews(null);
    using second = render(<Card fake={gone} />);
    await frames();
    assertEquals(gone.opened(), []);
    assertEquals(
      one(second.container, "[data-app-card-state]").getAttribute(
        "data-app-card-state",
      ),
      "unavailable",
    );

    // 연 뒤에 앱이 다른 판을 채택하면 view를 닫고 이유만 남긴다.
    const later = cardViews();
    using third = render(<Card fake={later} />);
    await frames();
    later.apps.set(APP, {
      ok: true,
      value: { name: "Orders", release: OTHER_REL, archived: false },
    });
    await act(() =>
      later.push({
        view_session: "view-1",
        app: APP,
        release: REL,
        mode: "live",
        screen: "summary",
        size: "card",
        connectionState: "unavailable",
      })
    );
    await frames();
    assertEquals(
      one(third.container, "[data-app-card-state]").getAttribute(
        "data-app-card-state",
      ),
      "contract_changed",
    );
    assert(
      later.calls.some((call) => call[0] === "close" && call[1] === "view-1"),
    );
    assertEquals(later.opened().length, 1);

    // main이 다른 판이라 거절해도 같은 이유다.
    const refused = cardViews();
    refused.refuseNext("conflict");
    using fourth = render(<Card fake={refused} />);
    await frames();
    assertEquals(
      one(fourth.container, "[data-app-card-state]").getAttribute(
        "data-app-card-state",
      ),
      "contract_changed",
    );
  });
});
