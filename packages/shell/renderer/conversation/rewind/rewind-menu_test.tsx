// agent-RW3e: Rewind menu. 메시지의 "Rewind to here"와 header ⋯의 "Rewind…"가 여는 같은 menu다. 선택지 셋, 막힌
// 선택지의 이유, preview의 복원할 것·건너뛰는 것·남는 영향, 늘 보이는 고정 안내, 실행 중 work 안내를 본다.
// 확인 창을 여는 일은 source의 몫이라 menu는 고른 범위를 부르는 쪽에 넘기는 데까지만 한다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  focus,
  one,
  pressAsync,
  render,
  settle,
} from "../../../../design/components/testing.ts";

import type {
  RewindChoice,
  RewindMenuView,
  RewindPreviewView,
  SourceResult,
} from "../agent-source.ts";
import { RewindMenu } from "./rewind-menu.tsx";

const M1 = "msg_01k6q000000000000000000001";
const M2 = "msg_01k6q000000000000000000002";
const M3 = "msg_01k6q000000000000000000003";

function menu(over: Partial<RewindMenuView> = {}): RewindMenuView {
  return {
    running: false,
    points: [
      { message: M1, blocked: {} },
      { message: M2, blocked: {} },
    ],
    ...over,
  };
}

const PREVIEW: RewindPreviewView = {
  restore: [{ kind: "file", target: "notes/a.md", reason: null }],
  skip: [{ kind: "file", target: "notes/b.md", reason: "edited_outside" }],
  remain: [
    { kind: "fact", target: "external_request", reason: "external_effect" },
  ],
  redo: true,
};

interface Calls {
  previews: [string, RewindChoice][];
  rewinds: { message: string; choice: RewindChoice }[];
  closed: number;
}

function mount(
  over: {
    menu?: RewindMenuView;
    message?: string | null;
    preview?: (
      message: string,
      choice: RewindChoice,
    ) => Promise<SourceResult<RewindPreviewView>>;
    rewind?: (
      input: { message: string; choice: RewindChoice },
    ) => Promise<SourceResult<void>>;
  } = {},
) {
  const calls: Calls = { previews: [], rewinds: [], closed: 0 };
  const view = render(
    <RewindMenu
      menu={over.menu ?? menu()}
      message={over.message === undefined ? M2 : over.message}
      excerpt={(message) => `excerpt of ${message.slice(-1)}`}
      preview={(message, choice) => {
        calls.previews.push([message, choice]);
        return over.preview?.(message, choice) ??
          Promise.resolve({ ok: true, value: PREVIEW });
      }}
      onRewind={(input) => {
        calls.rewinds.push(input);
        return over.rewind?.(input) ??
          Promise.resolve({ ok: true, value: undefined });
      }}
      onClose={() => {
        calls.closed += 1;
      }}
    />,
  );
  return { view, calls };
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>("[role=dialog]");
  assert(found !== null, "no dialog");
  return found;
}

function radios(): HTMLElement[] {
  return [...dialog().querySelectorAll<HTMLElement>("[role=radio]")];
}

function radioNamed(name: string): HTMLElement {
  const found = radios().find((radio) =>
    (radio.textContent ?? "").startsWith(name)
  );
  assert(found !== undefined, `no radio ${name}`);
  return found;
}

function primary(): HTMLButtonElement {
  return one(dialog(), "[data-rewind-primary]") as HTMLButtonElement;
}

function itemsOf(group: string): string[] {
  return [
    ...dialog().querySelectorAll(`[data-rewind-group="${group}"] [data-item]`),
  ].map((item) => item.textContent ?? "");
}

async function choose(name: string): Promise<void> {
  click(radioNamed(name));
  await settle();
}

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: menu는 Rewind to here 제목에 선택지 셋을 이 순서로 두고 아무것도 미리 고르지 않으며 바깥 변경은 되돌리지 않는다는 말이 늘 보인다", async () => {
  const { view } = mount();
  await settle();
  assertEquals(
    one(dialog(), "[data-rewind-title], h2, [role=heading]").textContent,
    "Rewind to here",
  );
  assertEquals(radios().map((radio) => radio.getAttribute("aria-checked")), [
    "false",
    "false",
    "false",
  ]);
  assertEquals(
    radios().map((radio) =>
      radio.querySelector("[data-rewind-label]")!.textContent
    ),
    [
      "Restore messages and documents",
      "Restore messages only",
      "Summarize from here",
    ],
  );
  assertEquals(
    one(dialog(), "[data-rewind-note]").textContent,
    "Changes made outside this session are not restored.",
  );
  // 고르기 전에는 적용할 수 없다.
  assert(primary().disabled);
  view.unmount();
  await settle();
});

Deno.test("lophn-agent/revert#R3 lophn-agent/revert#R6 [agent-RW3e]: 범위를 고르면 그 범위의 preview를 읽어 복원할 것·건너뛰는 것·남는 영향을 이유와 함께 따로 보인다", async () => {
  const { view, calls } = mount();
  await settle();
  await choose("Restore messages and documents");
  assertEquals(calls.previews, [[M2, "restore_all"]]);
  assertEquals(
    radioNamed("Restore messages and documents").getAttribute("aria-checked"),
    "true",
  );
  assertEquals(itemsOf("restore"), ["notes/a.md"]);
  assertEquals(itemsOf("skip"), [
    "notes/b.md This file changed after lophn wrote it, so it is left as it is.",
  ]);
  assertEquals(itemsOf("remain"), [
    "A request that already went out This already reached something outside lophn.",
  ]);
  // redo 예고
  assertEquals(
    one(dialog(), "[data-rewind-redo]").textContent,
    "You can redo this until you send your next message.",
  );
  assert(!primary().disabled);
  // 다른 범위를 고르면 그 범위의 preview로 바뀐다.
  await choose("Restore messages only");
  assertEquals(calls.previews.at(-1), [M2, "messages_only"]);
  view.unmount();
  await settle();
});

Deno.test("lophn-agent/revert#R16 [agent-RW3e]: 앱 write를 되돌리는 범위나 요약은 redo가 없다고 미리 말한다", async () => {
  const { view } = mount({
    preview: () =>
      Promise.resolve({ ok: true, value: { ...PREVIEW, redo: false } }),
  });
  await settle();
  await choose("Restore messages and documents");
  assertEquals(
    one(dialog(), "[data-rewind-redo]").textContent,
    "This can't be redone.",
  );
  view.unmount();
  await settle();
});

Deno.test("lophn-agent/revert#R12 [agent-RW3e]: 진행 중 보낸 수정 메시지에서는 문서 복원과 요약이 막히고 이유가 보이며 messages only만 고를 수 있다", async () => {
  const { view, calls } = mount({
    menu: menu({
      points: [{
        message: M2,
        blocked: { restore_all: "correction", summarize: "correction" },
      }],
    }),
  });
  await settle();
  const [all, only, summary] = radios();
  assertEquals(all!.getAttribute("aria-disabled"), "true");
  assertEquals(summary!.getAttribute("aria-disabled"), "true");
  assertEquals(only!.getAttribute("aria-disabled"), null);
  assertEquals(
    one(all!, "[data-rewind-blocked]").textContent,
    "Sent while work was in progress, so only messages can be restored.",
  );
  click(all!);
  await settle();
  assertEquals(calls.previews, []);
  assert(primary().disabled);
  click(only!);
  await settle();
  assertEquals(calls.previews, [[M2, "messages_only"]]);
  view.unmount();
  await settle();
});

Deno.test("lophn-agent/revert#R14 [agent-RW3e]: 파일 복원이 불가한 checkpoint는 Restore messages and documents만 막고 이유를 보이며 다른 범위는 고를 수 있다", async () => {
  const reasons: [string, string][] = [
    [
      "limit_total",
      "Too many earlier changes were kept, so documents from this point can't be restored.",
    ],
    [
      "limit_file",
      "A file here was too large to keep, so documents from this point can't be restored.",
    ],
    [
      "limit_count",
      "This point is too old, so documents from it can't be restored.",
    ],
    [
      "record_failed",
      "lophn couldn't keep the earlier content of a file here, so documents from this point can't be restored.",
    ],
  ];
  for (const [reason, text] of reasons) {
    const { view } = mount({
      menu: menu({
        points: [{
          message: M2,
          blocked: { restore_all: reason as "limit_file" },
        }],
      }),
    });
    await settle();
    const [all, only, summary] = radios();
    assertEquals(all!.getAttribute("aria-disabled"), "true", reason);
    assertEquals(one(all!, "[data-rewind-blocked]").textContent, text);
    assertEquals(only!.getAttribute("aria-disabled"), null);
    assertEquals(summary!.getAttribute("aria-disabled"), null);
    view.unmount();
    await settle();
  }
});

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: 실행 중인 work가 있으면 먼저 멈추라고 안내하고 선택지와 적용을 모두 막는다", async () => {
  const { view, calls } = mount({ menu: menu({ running: true }) });
  await settle();
  assertEquals(
    one(dialog(), "[data-rewind-running]").textContent,
    "Stop the work in progress first, then rewind.",
  );
  for (const radio of radios()) {
    assertEquals(radio.getAttribute("aria-disabled"), "true");
    click(radio);
  }
  await settle();
  assertEquals(calls.previews, []);
  assert(primary().disabled);
  view.unmount();
  await settle();
});

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: 적용 단추는 고른 checkpoint와 범위를 부르는 쪽에 넘기고 성공하면 menu를 닫는다", async () => {
  const { view, calls } = mount();
  await settle();
  await choose("Restore messages only");
  assertEquals(primary().textContent, "Rewind");
  click(primary());
  await settle();
  assertEquals(calls.rewinds, [{ message: M2, choice: "messages_only" }]);
  assertEquals(calls.closed, 1);
  view.unmount();
  await settle();
});

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: 요약은 단추 이름이 Summarize이고 끝날 때까지 기다리는 동안 다시 누를 수 없다", async () => {
  let finish: (result: SourceResult<void>) => void = () => {};
  const { view, calls } = mount({
    rewind: () =>
      new Promise<SourceResult<void>>((resolve) => {
        finish = resolve;
      }),
  });
  await settle();
  await choose("Summarize from here");
  assertEquals(primary().textContent, "Summarize");
  click(primary());
  await settle();
  assertEquals(primary().textContent, "Summarizing…");
  assert(primary().disabled);
  click(primary());
  await settle();
  assertEquals(calls.rewinds.length, 1);
  assertEquals(calls.closed, 0);
  await act(async () => {
    finish({ ok: true, value: undefined });
    await Promise.resolve();
  });
  await settle();
  assertEquals(calls.closed, 1);
  view.unmount();
  await settle();
});

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: 적용을 시작하지 못하면 이유를 말하고 menu를 열어 둔다(작업 중이면 먼저 멈추라고)", async () => {
  for (
    const [code, text] of [
      ["conflict", "Stop the work in progress first, then rewind."],
      ["summary_failed", "Couldn't summarize this part, so nothing changed."],
      ["unavailable", "Couldn't start the rewind. Try again."],
    ]
  ) {
    const { view, calls } = mount({
      rewind: () => Promise.resolve({ ok: false, code }),
    });
    await settle();
    await choose("Restore messages only");
    click(primary());
    await settle();
    assertEquals(one(dialog(), "[role=alert]").textContent, text);
    assertEquals(calls.closed, 0);
    view.unmount();
    await settle();
  }
});

Deno.test("lophn-agent/revert#R3 [agent-RW3e]: preview를 읽지 못하면 적용하지 않고 그렇다고 말한다", async () => {
  const { view } = mount({
    preview: () => Promise.resolve({ ok: false, code: "unavailable" }),
  });
  await settle();
  await choose("Restore messages and documents");
  assertEquals(
    one(dialog(), "[role=alert]").textContent,
    "Couldn't load what would change. Try again.",
  );
  assert(primary().disabled);
  view.unmount();
  await settle();
});

Deno.test("shell/desktop#R38 lophn-agent/revert#R15 [agent-RW3e]: header의 Rewind…에서 열면 시점을 고르는 칸이 있고 마지막 메시지가 기본이며 바꾸면 그 시점의 preview를 읽는다", async () => {
  const { view, calls } = mount({
    message: null,
    menu: menu({
      points: [
        { message: M1, blocked: {} },
        { message: M2, blocked: { restore_all: "correction" } },
        { message: M3, blocked: {} },
      ],
    }),
  });
  await settle();
  const trigger = one(dialog(), "[role=combobox]");
  assertEquals((trigger.textContent ?? "").trim(), "excerpt of 3");
  assertEquals(trigger.getAttribute("aria-label") ?? "", "");
  await choose("Restore messages only");
  assertEquals(calls.previews.at(-1), [M3, "messages_only"]);
  // 목록을 열어 한 칸 위(둘째 메시지)를 고른다.
  focus(trigger);
  await pressAsync(trigger, "ArrowDown");
  assertEquals(
    [...document.querySelectorAll("[role=listbox] [role=option]")].map((
      option,
    ) => (option.textContent ?? "").trim()),
    ["excerpt of 1", "excerpt of 2", "excerpt of 3"],
  );
  await pressAsync(document.activeElement!, "ArrowUp");
  await pressAsync(document.activeElement!, "Enter");
  // 시점을 바꾸면 그 시점에서 막힌 선택지가 달라지고, 고른 범위의 preview를 다시 읽는다.
  assertEquals(calls.previews.at(-1), [M2, "messages_only"]);
  assertEquals(radios()[0]!.getAttribute("aria-disabled"), "true");
  view.unmount();
  await settle();
});

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: 메시지에서 연 menu에는 시점을 고르는 칸이 없다", async () => {
  const { view } = mount({ message: M1 });
  await settle();
  assertEquals(dialog().querySelector("[role=combobox]"), null);
  view.unmount();
  await settle();
});

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: Cancel과 Escape는 아무것도 하지 않고 닫는다", async () => {
  {
    const { view, calls } = mount();
    await settle();
    click(one(dialog(), "[data-rewind-cancel]"));
    await settle();
    assertEquals([calls.rewinds, calls.closed], [[], 1]);
    view.unmount();
    await settle();
  }
  {
    const { view, calls } = mount();
    await settle();
    await pressAsync(dialog(), "Escape");
    assertEquals([calls.rewinds, calls.closed], [[], 1]);
    view.unmount();
    await settle();
  }
});

Deno.test("lophn-agent/revert#R3 [agent-RW3e]: 건너뜀과 남는 영향 목록에는 receipt 원문이나 안쪽 이름이 없다", async () => {
  const { view } = mount({
    preview: () =>
      Promise.resolve({
        ok: true,
        value: {
          restore: [],
          skip: [],
          remain: [{
            kind: "app",
            target: "tcl_01k6q000000000000000000009",
            reason: "no_revert_command",
          }],
          redo: false,
        },
      }),
  });
  await settle();
  await choose("Restore messages and documents");
  assertEquals(itemsOf("remain"), [
    "An app change The app has no way to undo this change.",
  ]);
  const text = (dialog().textContent ?? "").toLowerCase();
  for (const word of ["tcl_", "receipt", "no_revert_command"]) {
    assert(!text.includes(word), word);
  }
  view.unmount();
  await settle();
});
