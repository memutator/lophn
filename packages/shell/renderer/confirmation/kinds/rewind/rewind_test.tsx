import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import {
  click,
  render,
  settle,
} from "../../../../../design/components/testing.ts";
import type {
  ConfirmationFrameApi,
  ConfirmationResult,
  ConfirmationView,
  SubmitResult,
} from "../../frame/api.ts";
import { ConfirmationScreen } from "../../screen.tsx";
import { REWIND } from "./rewind.tsx";

const SES = "ses_01arz3ndektsv4rrffq69g5fav";
const MSG = "msg_01arz3ndektsv4rrffq69g5fav";
const RVT = "rvt_01arz3ndektsv4rrffq69g5fav";
const TCL = "tcl_01arz3ndektsv4rrffq69g5fav";

type Sent = Parameters<ConfirmationFrameApi["submit"]>[0];

function fakeApi(view: ConfirmationView, result?: SubmitResult) {
  const sent: Sent[] = [];
  let cancelled = 0;
  const api: ConfirmationFrameApi = {
    getDisplay: () => Promise.resolve(view),
    submit: (input) => {
      sent.push(input);
      return Promise.resolve(
        result ?? {
          outcome: "decided",
          receipt: { kind: "entity", id: RVT },
          result: "applied",
        },
      );
    },
    cancel: () => {
      cancelled += 1;
      return Promise.resolve({ outcome: "dismissed" });
    },
  };
  return { api, sent, cancelled: () => cancelled };
}

type Item = { class: string; target: string; reason: string | null };

function rewind(
  over: {
    choice?: string;
    restore?: Item[];
    skip?: Item[];
    remain?: Item[];
    redo?: boolean;
    second?: boolean;
    decisions?: string[];
  } = {},
): ConfirmationView {
  return {
    displayId: "dsp_1",
    request: {
      kind: "owner_decision",
      concern: "lophn-agent/revert",
      decision: "Rewind",
      targets: [SES, MSG],
      input: { kind: "inline", value: {} },
      comparison: {},
    },
    view: {
      kind: "rewind",
      choice: over.choice ?? "restore_all",
      redo: over.redo ?? true,
      restore: over.restore ?? [
        { class: "file", target: "notes/a.md", reason: null },
      ],
      skip: over.skip ?? [],
      remain: over.remain ?? [],
    },
    decisions: over.decisions ?? [REWIND],
    ...(over.second === true ? { second: true } : {}),
  };
}

async function show(api: ConfirmationFrameApi) {
  const view = render(<ConfirmationScreen api={api} theme={{}} />);
  await settle();
  return view;
}

function find(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  assert(found !== null, `no ${selector}`);
  return found as HTMLElement;
}

function items(root: ParentNode, group: string): string[] {
  return [...root.querySelectorAll(`[data-group="${group}"] [data-item]`)]
    .map((item) => item.textContent ?? "");
}

Deno.test("lophn-agent/revert#R3 shell/confirmation-window#R2: 창은 고른 범위를 문장으로 묻고 복원할 것·건너뛰는 것·남는 영향을 이유와 함께 따로 보인다", async () => {
  const { api } = fakeApi(rewind({
    restore: [
      { class: "file", target: "notes/a.md", reason: null },
      { class: "app", target: TCL, reason: null },
    ],
    skip: [{ class: "file", target: "notes/b.md", reason: "edited_outside" }],
    remain: [
      { class: "fact", target: "external_request", reason: "external_effect" },
    ],
  }));
  using view = await show(api);
  assertEquals(
    find(view.container, "h1").textContent,
    "Rewind messages and documents?",
  );
  assertEquals(items(view.container, "restore"), [
    "notes/a.md",
    "An app change",
  ]);
  assertEquals(items(view.container, "skip"), [
    "notes/b.md This file changed after lophn wrote it, so it is left as it is.",
  ]);
  assertEquals(items(view.container, "remain"), [
    "A request that already went out This already reached something outside lophn.",
  ]);
  // 바깥 변경은 되돌리지 않는다는 말이 늘 보인다.
  assertStringIncludes(
    find(view.container, "[data-section='effect']").textContent ?? "",
    "Changes made outside this session are not restored.",
  );
  // 안쪽 이름·ID는 기본 화면에 없다.
  const text = (view.container.textContent ?? "").toLowerCase();
  for (const word of ["tcl_", "receipt", "ses_", "msg_", "preview_hash"]) {
    assert(!text.includes(word), word);
  }
});

Deno.test("lophn-agent/revert#R15: 제목과 설명은 범위마다 다르다", async () => {
  const cases: [string, string][] = [
    ["restore_all", "Rewind messages and documents?"],
    ["messages_only", "Rewind messages only?"],
    ["summarize", "Summarize from here?"],
  ];
  for (const [choice, title] of cases) {
    const { api } = fakeApi(rewind({ choice, restore: [] }));
    using view = await show(api);
    assertEquals(find(view.container, "h1").textContent, title);
  }
});

Deno.test("lophn-agent/revert#R16: redo를 할 수 있으면 다음 메시지를 보내기 전까지라고, 없으면 못 한다고 미리 말한다", async () => {
  {
    const { api } = fakeApi(rewind({ redo: true }));
    using view = await show(api);
    assertStringIncludes(
      find(view.container, "[data-section='revert']").textContent ?? "",
      "You can redo this until you send your next message.",
    );
  }
  {
    const { api } = fakeApi(rewind({
      redo: false,
      restore: [{ class: "app", target: TCL, reason: null }],
    }));
    using view = await show(api);
    assertStringIncludes(
      find(view.container, "[data-section='revert']").textContent ?? "",
      "This can't be redone",
    );
  }
});

Deno.test("shell/confirmation-window#R4 platform/approvals#R9: 남는 것이 없으면 Rewind 한 번으로 결정 이름 하나만 보내고 닫기는 결정이 아니다", async () => {
  {
    const { api, sent, cancelled } = fakeApi(rewind());
    using view = await show(api);
    click(find(view.container, "[data-decision]"));
    await settle();
    assertEquals(sent.length, 1);
    assertEquals(sent[0]!.decision, REWIND);
    assertEquals(sent[0]!.input, undefined);
    assertEquals(sent[0]!.confirmedSecond, undefined);
    assertEquals(cancelled(), 0);
    assertStringIncludes(view.container.textContent ?? "", "Rewound.");
  }
  {
    const { api, sent, cancelled } = fakeApi(rewind());
    using view = await show(api);
    click(find(view.container, "[data-action='cancel']"));
    await settle();
    assertEquals(sent, []);
    assertEquals(cancelled(), 1);
  }
});

Deno.test("lophn-agent/revert#R7: 건너뛰거나 남는 영향이 있으면 Rewind가 먼저 그 목록을 다시 보이고, 확인한 뒤에야 결정을 보낸다", async () => {
  const { api, sent } = fakeApi(rewind({
    second: true,
    skip: [{ class: "file", target: "notes/b.md", reason: "link_path" }],
  }));
  using view = await show(api);
  click(find(view.container, "[data-decision]"));
  await settle();
  // 첫 누름은 보내지 않고 남는 것만 다시 보인다.
  assertEquals(sent, []);
  find(view.container, "[data-decision][data-step='second']");
  assertEquals(items(view.container, "skip"), [
    "notes/b.md This path is a link, so it is left as it is.",
  ]);
  assertEquals(items(view.container, "restore"), []);
  click(find(view.container, "[data-decision][data-step='second']"));
  await settle();
  assertEquals(sent.length, 1);
  assertEquals(sent[0]!.decision, REWIND);
  assertEquals(sent[0]!.confirmedSecond, true);
});

Deno.test("lophn-agent/revert#R7: 두 번째 단계에서 Back을 누르면 아무것도 보내지 않고 처음 목록으로 돌아간다", async () => {
  const { api, sent } = fakeApi(rewind({
    second: true,
    skip: [{ class: "file", target: "notes/b.md", reason: "link_path" }],
  }));
  using view = await show(api);
  click(find(view.container, "[data-decision]"));
  await settle();
  click(find(view.container, "[data-action='back']"));
  await settle();
  assertEquals(sent, []);
  assertEquals(items(view.container, "restore"), ["notes/a.md"]);
});

Deno.test("shell/confirmation-window#R5: 고를 결정이 없으면 Rewind 버튼이 없고 닫기만 남는다", async () => {
  const { api } = fakeApi(rewind({ decisions: [] }));
  using view = await show(api);
  assertEquals(view.container.querySelector("[data-decision]"), null);
  assert(view.container.querySelector("[data-action='cancel']") !== null);
});

Deno.test("lophn-agent/revert#R3 lophn-agent/revert#R11: 결과는 실제 적용·접수·부분·모름·막힘을 구별해 말한다", async () => {
  const cases: [ConfirmationResult, string][] = [
    ["applied", "Rewound."],
    ["applying", "undoing the app changes"],
    ["partial", "Some of it was rewound."],
    ["uncertain", "Some results aren't known yet."],
    ["blocked", "Nothing changed."],
  ];
  for (const [result, expected] of cases) {
    const { api } = fakeApi(rewind(), {
      outcome: "decided",
      receipt: { kind: "entity", id: RVT },
      result,
    } as SubmitResult);
    using view = await show(api);
    click(find(view.container, "[data-decision]"));
    await settle();
    assertStringIncludes(
      (view.container.textContent ?? "").toLowerCase(),
      expected.toLowerCase(),
    );
  }
});
