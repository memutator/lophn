import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  type ResizeSource,
  ResizeSourceProvider,
} from "@lophn/design/components";
import {
  click,
  isFocused,
  render,
} from "../../../../../packages/design/components/testing.ts";

import {
  IDLE,
  type SaveRequest,
  type SaveState,
  VisualBlock,
  type VisualHost,
} from "./block-frame.tsx";
import {
  appCardBlock,
  barBlock,
  categoryLineBlock,
  diagramBlock,
  DOC,
  lineBlock,
  scatterBlock,
  tableBlock,
  VER,
} from "./testdata/blocks.ts";

const MESSAGE = "msg_01h455vb4pex5v6nkc6gd5f001";

const fixedSize: ResizeSource = {
  observe(_element, onSize) {
    onSize({ width: 360, height: 240 });
    return () => {};
  },
};

async function flush(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function host(patch: Partial<VisualHost> = {}) {
  const opened: [string, string | null][] = [];
  const saved: SaveRequest[] = [];
  const value: VisualHost = {
    documentTitle: (document) =>
      Promise.resolve(
        document === DOC
          ? { ok: true, value: "Budget 2026" }
          : { ok: false, code: "not_found" },
      ),
    open: (document, version) => opened.push([document, version]),
    save: (request) => saved.push(request),
    saveState: () => IDLE,
    now: () => new Date("2026-10-06T09:00:00Z"),
    ...patch,
  };
  return { value, opened, saved };
}

function blocks(list: readonly unknown[], visuals: VisualHost) {
  return (
    <ResizeSourceProvider value={fixedSize}>
      {list.map((block, index) => (
        <VisualBlock
          key={index}
          message={MESSAGE}
          block={block}
          host={visuals}
        />
      ))}
    </ResizeSourceProvider>
  );
}

function one(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`no element for ${selector}`);
  return found as HTMLElement;
}

Deno.test("shell/workspace#R12: 표·막대·선·산점 차트와 도표를 설치된 SDK로 답 안에 그린다", async () => {
  const { value } = host();
  using view = render(
    blocks(
      [tableBlock, barBlock, lineBlock, scatterBlock, diagramBlock],
      value,
    ),
  );
  await flush();
  const root = view.container;
  assertEquals(
    [...root.querySelectorAll("[data-visual]")].map((item) =>
      item.getAttribute("data-visual")
    ),
    ["table", "chart", "chart", "chart", "diagram"],
  );
  // 표는 ui-table, 차트·도표는 ui-chart의 SVG다.
  const table = one(root, "[data-visual-key='orders'] table");
  assert(table.textContent!.includes("Harbor Books"));
  assert(table.textContent!.includes("Yes"));
  assertEquals(
    [...root.querySelectorAll("svg[data-chart]")].map((svg) =>
      svg.getAttribute("data-chart")
    ),
    ["bar", "line", "scatter", "graph"],
  );
  // 제목·설명·관측 시각·출처가 틀에 있다.
  const orders = one(root, "[data-visual-key='orders']");
  assertEquals(orders.getAttribute("aria-label"), "Open orders");
  assert(
    one(orders, "[data-visual-observed]").textContent!.startsWith("Observed"),
  );
  assertEquals(
    one(orders, "[data-visual-source='app_command']").textContent,
    "App result: list_orders",
  );
  assertEquals(
    one(root, "[data-visual-nodes]").textContent,
    "NewThe order arrived.",
  );
});

Deno.test("shell/workspace#R12: 블록의 label·text는 escape되고 agent의 HTML·script는 요소로 만들어지지 않는다", async () => {
  const { value } = host();
  const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const titled = { ...barBlock, key: "hostile", title: hostile };
  const kind = { ...tableBlock, key: "html", kind: "html", payload: hostile };
  using view = render(blocks([titled, kind], value));
  await flush();
  const root = view.container;
  assertEquals(root.querySelectorAll("img, script, iframe").length, 0);
  // 제목에 markup이 든 블록은 이용 불가이고 제목 대신 기본 이름이다.
  const first = one(root, "[data-visual-key='hostile']");
  assertEquals(first.getAttribute("data-visual"), "unavailable");
  assertEquals(
    one(first, "[data-visual-unavailable]").getAttribute(
      "data-visual-unavailable",
    ),
    "markup",
  );
  assert(!first.textContent!.includes("onerror"));
  // 모르는 종류는 그리지 않고 설명·출처를 남긴다.
  const second = one(root, "[data-visual-key='html']");
  assertEquals(
    one(second, "[data-visual-unavailable]").textContent,
    "This kind of visual can't be shown here.",
  );
  assertEquals(
    one(second, "[data-visual-description]").textContent,
    tableBlock.description,
  );
  assertEquals(second.querySelectorAll("[data-visual-sources]").length, 1);
  // 이용 불가 블록은 문서로 남기기를 두지 않는다.
  assertEquals(second.querySelector("[data-save-visual]"), null);
});

Deno.test("shell/workspace#R12: 이용 불가·빈 블록·앱 카드는 그 자리 상태이고 다른 블록을 막지 않는다", async () => {
  const { value } = host();
  const broken = {
    ...diagramBlock,
    key: "broken",
    payload: {
      nodes: [{ key: "a", label: "A" }],
      edges: [{ from: "a", to: "b" }],
    },
  };
  const empty = {
    ...tableBlock,
    key: "empty",
    payload: { ...tableBlock.payload, rows: [] },
  };
  using view = render(
    blocks([broken, empty, appCardBlock, categoryLineBlock], value),
  );
  await flush();
  const root = view.container;
  assertEquals(
    one(root, "[data-visual-key='broken'] [data-visual-unavailable]")
      .getAttribute("data-visual-unavailable"),
    "shape",
  );
  // 빈 표의 다음 행동은 비어 있는 이유를 말하는 설명으로 간다.
  const emptyBlock = one(root, "[data-visual-key='empty']");
  assertEquals(
    one(emptyBlock, "[data-state='empty'] p").textContent,
    "This visual has no data.",
  );
  click(one(emptyBlock, "[data-state='empty'] button"));
  assert(isFocused(one(emptyBlock, "[data-visual-description]")));
  // 창 view 통로가 없는 자리(overlay·테스트)의 앱 카드는 안내와 설명만 둔다.
  assertEquals(
    one(root, "[data-visual-app-card]").textContent,
    "App cards can't be shown here.",
  );
  // 범주 축의 선은 같은 데이터를 표로 보인다.
  const steps = one(root, "[data-visual-key='steps']");
  assertEquals(
    one(steps, "[data-visual-chart]").getAttribute("data-visual-chart"),
    "table",
  );
  assert(one(steps, "table").textContent!.includes("Review"));
});

Deno.test("shell/workspace#R13: 출처의 고정 문서 판을 열고 열 수 없는 문서는 열 수 없다고 보인다", async () => {
  const { value, opened } = host();
  const missing = {
    ...barBlock,
    key: "missing",
    sources: [{
      kind: "document",
      reference: {
        document: "doc_01h455vb4pex5v6nkc6gd5fdw9",
        version: VER,
      },
      observed_at: null,
    }],
  };
  using view = render(blocks([barBlock, missing], value));
  await flush();
  const link = one(
    view.container,
    `[data-visual-key='spend'] [data-visual-document='${DOC}@${VER}']`,
  );
  assertEquals(link.textContent, "Budget 2026Spend");
  click(link);
  assertEquals(opened, [[DOC, VER]]);
  const closed = one(
    view.container,
    "[data-visual-key='missing'] [data-visual-document]",
  );
  assert(closed.hasAttribute("data-unavailable"));
  assert((closed as HTMLButtonElement).disabled);
  assertEquals(closed.textContent, "Document you can't open");
});

Deno.test("shell/workspace#R13: [Save as document]는 요청을 보내고 진행과 저장 뒤 고정 문서 링크를 그 블록에 보인다", async () => {
  let state: SaveState = IDLE;
  const { value, saved, opened } = host({ saveState: () => state });
  using view = render(blocks([barBlock], value));
  await flush();
  const button = one(view.container, "[data-save-visual='spend']");
  assertEquals(button.textContent, "Save as document");
  click(button);
  assertEquals(saved, [{
    message: MESSAGE,
    block: "spend",
    title: "Monthly spend",
  }]);
  for (
    const [next, notice] of [
      [{ state: "sending" }, "Asking lophn to save this as a document."],
      [{ state: "requested" }, "lophn is saving this as a document."],
      [{ state: "failed" }, "Couldn't ask lophn to save this. Try again."],
      [
        { state: "not-saved" },
        "lophn didn't save a document. Its answer says why.",
      ],
    ] as const
  ) {
    state = next;
    view.rerender(blocks([barBlock], value));
    await flush();
    const frame = one(view.container, "[data-visual-save]");
    assertEquals(frame.getAttribute("data-visual-save"), next.state);
    assertEquals(one(frame, "[role='status']").textContent, notice);
    const busy = next.state === "sending" || next.state === "requested";
    assertEquals(
      (one(frame, "[data-save-visual]") as HTMLButtonElement).disabled,
      busy,
    );
  }
  state = { state: "saved", links: [{ document: DOC, version: VER }] };
  view.rerender(blocks([barBlock], value));
  await flush();
  const savedLink = one(
    view.container,
    `[data-visual-saved] [data-visual-document='${DOC}@${VER}']`,
  );
  assertEquals(savedLink.textContent, "Budget 2026");
  click(savedLink);
  assertEquals(opened, [[DOC, VER]]);
  // 보낼 수 없는 자리(끝난 세션)는 버튼을 두지 않는다.
  view.rerender(blocks([barBlock], { ...value, save: undefined }));
  await flush();
  assertEquals(view.container.querySelector("[data-save-visual]"), null);
});
