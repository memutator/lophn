import { assert, assertEquals } from "@std/assert";
import { createElement } from "react";

import { render } from "@lophn/design/component-render";
import type { Display } from "../display.ts";
import { fileDeleteDisplay, readDisplay } from "../display.ts";
import type { ConfirmationFrameApi } from "../frame/api.ts";
import { ConfirmationLayout } from "../layout/layout.tsx";
import { ConfirmationScreen } from "../screen.tsx";

function show(display: Display): HTMLElement {
  const view = render(
    createElement(ConfirmationLayout, {
      display,
      actions: createElement(
        "button",
        { "data-decision": "confirm" },
        "Delete file",
      ),
    }),
  );
  return view.container;
}

const LONG_PATH =
  "/home/person/projects/notes/very-long-folder-name/another-folder/the-file-with-a-very-long-name.md";

function documentDisplay(): Display {
  return {
    title: "Delete this file?",
    subject: "This file will be removed from the project.",
    path: LONG_PATH,
    effect: "The file leaves the project. This cannot be undone.",
    reversible: false,
    action: "Delete file",
    details: [
      { label: "Requested by", value: "Ada" },
      { label: "Content", value: "a".repeat(64) },
    ],
    change: {
      kind: "document",
      before: [
        { role: "context", lines: [{ text: "Opening paragraph." }] },
        { role: "changed", lines: [{ text: "Old paragraph." }] },
        { role: "context", lines: [{ text: "Closing paragraph." }] },
      ],
      after: [
        { role: "context", lines: [{ text: "Opening paragraph." }] },
        { role: "changed", lines: [{ text: "New paragraph." }] },
        { role: "context", lines: [{ text: "Closing paragraph." }] },
      ],
      full: [
        { kind: "same", text: "Opening paragraph." },
        { kind: "delete", text: "Old paragraph." },
        { kind: "add", text: "New paragraph." },
      ],
    },
  };
}

function sections(root: ParentNode): string[] {
  return [...root.querySelectorAll("[data-section]")].map((node) =>
    node.getAttribute("data-section") ?? ""
  );
}

Deno.test("shell/confirmation-window#R2: 기본 순서는 대상·변경, 영향·위험, revert 가능, 결정이다", () => {
  const root = show(documentDisplay());
  assertEquals(sections(root), ["subject", "effect", "revert", "details"]);
  const layout = root.querySelector("[data-layout]");
  assert(layout !== null);
  const actions = layout.querySelector("[role=group]");
  assert(actions !== null);
  // 결정 자리는 마지막 섹션보다 뒤다.
  assertEquals(
    Boolean(
      layout.querySelector("[data-section=revert]")!.compareDocumentPosition(
        actions,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ),
    true,
  );
  assertEquals(root.querySelector("h1")?.textContent, "Delete this file?");
});

Deno.test("shell/confirmation-window#R2: 최대폭은 640px이고 좁으면 창 너비를 넘지 않는다", () => {
  const root = show(documentDisplay());
  const layout = root.querySelector("[data-layout]") as HTMLElement;
  const wide = getComputedStyle(layout).maxWidth;
  assertEquals(wide, "640px");
  // 창이 좁으면 width 100%라 부모를 넘지 않는다.
  const parent = layout.parentElement as HTMLElement;
  parent.style.width = "400px";
  assert(layout.getBoundingClientRect().width <= 400);
});

Deno.test("shell/confirmation-window#R2: 주체·시각·이유·근거는 Details에 접혀 있다", () => {
  const root = show(documentDisplay());
  const details = root.querySelector("[data-section=details]");
  assert(details !== null);
  assertEquals((details as HTMLDetailsElement).open, false);
  assertEquals(details.querySelector("summary")?.textContent, "Details");
  assert(details.textContent?.includes("Ada"));
  // hash 같은 내부 값은 기본 본문이 아니라 Details 안이다.
  const body = root.querySelector("[data-section=subject]");
  assert(!body?.textContent?.includes("a".repeat(64)));
});

Deno.test("shell/confirmation-window#R3: 문서 전후는 세로이고 바뀐 문단에 +/− 표지가 있다", () => {
  const root = show(documentDisplay());
  const sides = [...root.querySelectorAll("[data-section=subject] section")];
  assertEquals(sides.length, 2);
  assert(
    sides[0].getBoundingClientRect().top <=
      sides[1].getBoundingClientRect().top,
  );
  const changed = [...root.querySelectorAll("[data-role=changed]")];
  assertEquals(changed.length, 2);
  assertEquals(changed[0].textContent?.trim().slice(0, 1), "−");
  assertEquals(changed[1].textContent?.trim().slice(0, 1), "+");
  // 앞뒤 1문단 문맥도 함께 보인다.
  assert(root.textContent?.includes("Opening paragraph."));
  assert(root.textContent?.includes("Closing paragraph."));
});

Deno.test("shell/confirmation-window#R3: 전체 diff는 펼치기 전엔 접혀 있다", () => {
  const root = show(documentDisplay());
  const full = root.querySelector("details:not([data-section])");
  assert(full !== null);
  assertEquals((full as HTMLDetailsElement).open, false);
  assertEquals(full.querySelector("summary")?.textContent, "Full change");
});

Deno.test("shell/confirmation-window#R3: 설정은 항목과 값을 보이고 긴 줄은 자르지 않는다", () => {
  const long = "x".repeat(240);
  const root = show({
    ...documentDisplay(),
    change: {
      kind: "setting",
      items: [{ label: "Name", before: "old", after: long }],
    },
  });
  const item = root.querySelector("[data-change=setting]");
  assert(item !== null);
  assert(item.textContent?.includes("Name"));
  assert(item.textContent?.includes("old"));
  assert(item.textContent?.includes(long));
  const shown = item.querySelector("[data-side=after]") as HTMLElement;
  assertEquals(shown.textContent, long);
  // 잘림 표시(말줄임)를 쓰지 않는다. 기본값은 자르지 않는 clip이다.
  assert(getComputedStyle(shown).textOverflow !== "ellipsis");
});

Deno.test("shell/confirmation-window#R3: 자료가 없거나 생략되면 그렇다고 말한다", () => {
  const missing = show({ ...documentDisplay(), change: undefined });
  assertEquals(
    missing.querySelector("[data-change=missing]")?.textContent,
    "There is nothing to compare for this change.",
  );
  const omitted = show({
    ...documentDisplay(),
    change: {
      kind: "document",
      before: [],
      after: [],
      omitted: "could not read",
    },
  });
  assertEquals(
    omitted.querySelector("[data-change=omitted]")?.textContent,
    "Some of this change could not be shown.",
  );
  assertEquals(omitted.textContent?.includes("Nothing here."), true);
});

Deno.test("shell/wording#R12: 정확한 경로는 고정폭 원문이고 내부 값은 Details에만 있다", () => {
  const root = show(documentDisplay());
  const path = root.querySelector("[data-section=subject]")
    ?.querySelectorAll("p")[1] as HTMLElement | undefined;
  assert(path !== undefined);
  assertEquals(path.textContent, LONG_PATH);
  assertEquals(path.textContent?.includes("…"), false);
  const family = getComputedStyle(path).fontFamily.toLowerCase();
  assert(family.includes("mono"), `고정폭이 아니다: ${family}`);
});

Deno.test("shell/confirmation-window#R2: owner decision 화면은 파일 지우기를 배치로 그린다", () => {
  const decided: string[] = [];
  const api: ConfirmationFrameApi = {
    getDisplay: () =>
      Promise.resolve({
        displayId: "dsp_1",
        request: {
          kind: "owner_decision",
          concern: "documents",
          decision: "delete_file",
          targets: ["doc_00000000000000000000000001"],
          input: { kind: "inline", value: {} },
          comparison: { path: LONG_PATH },
        },
      }),
    submit: (input) => {
      decided.push(input.decision);
      return Promise.resolve({ ok: true });
    },
    cancel: () => Promise.resolve({ outcome: "dismissed" }),
  };
  const view = render(createElement(ConfirmationScreen, { api, theme: {} }));
  return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
    assertEquals(
      view.container.querySelector("h1")?.textContent,
      "Delete this file?",
    );
    assert(view.container.textContent?.includes(LONG_PATH));
    const button = view.container.querySelector(
      "[data-decision]",
    ) as HTMLElement;
    button.click();
    assertEquals(decided, ["delete_file"]);
  });
});

Deno.test("shell/confirmation-window#R2: 첫 owner decision은 파일 지우기이고 제목이 결정을 말한다", () => {
  const display = fileDeleteDisplay({
    path: LONG_PATH,
    document: "doc_00000000000000000000000001",
  });
  assertEquals(display.title, "Delete this file?");
  assertEquals(display.path, LONG_PATH);
  assertEquals(display.reversible, false);
  assertEquals(display.action, "Delete file");
  assertEquals(display.details[0]?.value, "doc_00000000000000000000000001");
  assertEquals(readDisplay({}), undefined);
});
