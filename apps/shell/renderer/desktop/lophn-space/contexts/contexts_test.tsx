import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  render,
} from "../../../../../../packages/design/components/testing.ts";

import { ContextsScreen } from "./contexts-screen.tsx";
import { LophnSpace } from "../lophn-space.tsx";
import { fakeSource } from "../testdata/fake-source.ts";
import { CANDIDATE, fakeContexts, FOCUS } from "./testdata/fake-source.ts";
import type { MeaningInput } from "./source.ts";
import { byText, find, flush, pressTab, submit } from "../testdata/dom.ts";

type Read = [string, string | null, string | null];

async function open(data: Parameters<typeof fakeContexts>[0] = {}) {
  const fake = fakeContexts(data);
  const reads: Read[] = [];
  const saved: [string, string][] = [];
  let asked = 0;
  const view = render(
    <ContextsScreen
      source={fake.source}
      initialFocus={FOCUS.id}
      onRead={(...args) => reads.push(args)}
      onAsk={() => asked++}
      save={(name, text) => saved.push([name, text])}
    />,
  );
  await flush();
  return { ...fake, view, reads, saved, asked: () => asked };
}

function item(root: ParentNode, title: string): HTMLElement {
  for (const row of root.querySelectorAll("[data-item]")) {
    if (row.querySelector("button")?.textContent?.startsWith(title)) {
      return row as HTMLElement;
    }
  }
  throw new Error(`no item ${title}`);
}

function expand(row: HTMLElement): void {
  click(row.querySelector("button")!);
}

function typeText(element: Element, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

Deno.test("shell/desktop#R28: contexts 화면은 사람이 지은 Focus 이름과 목적을 보이고 항목을 관점별로 나누며 이유와 부족한 자료는 펼쳐야 보인다", async () => {
  const { view, of } = await open();
  using _view = view;
  assertEquals(of("list")[0]!.args, ["active"]);
  const row = find(view.container, `[data-focus='${FOCUS.id}']`);
  assertEquals(row.getAttribute("aria-current"), "true");
  assert(row.textContent!.includes("Grocery budget"));
  assertEquals(
    find(view.container, "[data-focus-head] h1").textContent,
    "Focus: Grocery budget",
  );
  assertEquals(
    find(view.container, "[data-focus-purpose]").textContent,
    FOCUS.purpose,
  );
  const sections = [...view.container.querySelectorAll("[data-perspective]")];
  assertEquals(
    sections.map((section) => section.getAttribute("data-perspective")),
    ["basis", "reference", "watch"],
  );
  assertEquals(
    sections.map((section) => section.querySelector("h2")!.textContent),
    ["Baseline2", "Reference0", "Follow changes4"],
  );
  // 빈 관점도 사라지지 않는다.
  assertEquals(
    sections[1]!.querySelector("p")!.textContent,
    "Nothing here yet.",
  );
  // 이유·부족한 자료는 처음에 접혀 있다.
  assertEquals(view.container.querySelectorAll("[data-item-body]").length, 0);
  const plan = item(view.container, "Budget plan");
  expand(plan);
  await flush();
  assertEquals(
    find(plan, "[data-item-reason]").textContent,
    "The plan we agreed on.",
  );
  assertEquals(plan.querySelector("[data-item-gaps]"), null);
  click(find(plan, "[data-open-item]"));
  const rules = item(view.container, "House rules");
  assertEquals(
    find(rules, "[data-item-state]").textContent,
    "What's missing",
  );
  expand(rules);
  await flush();
  assertEquals(
    find(rules, "[data-gap]").getAttribute("data-gap"),
    "section-missing",
  );
  assertEquals(rules.querySelector("[data-open-item]"), null);
});

Deno.test("shell/wording#R13: 관점은 Baseline·Reference·Follow changes로만 부르고 안쪽 이름은 화면에 없다", async () => {
  const { view } = await open();
  using _view = view;
  const text = view.container.textContent ?? "";
  for (const label of ["Baseline", "Reference", "Follow changes"]) {
    assert(text.includes(label), label);
  }
  for (const inner of ["basis", "watch", "perspective", "context"]) {
    assert(!text.toLowerCase().includes(inner), inner);
  }
});

Deno.test("shell/desktop#R28: Follow changes는 확인된 변화·section 소실·미확인을 다른 글로 구별하고 앱 자료는 자동으로 확인하지 않는다", async () => {
  const { view, reads } = await open();
  using _view = view;
  const watch = find(view.container, "[data-perspective='watch']");
  const states = [...watch.querySelectorAll("[data-item-state]")].map((
    node,
  ) => [node.getAttribute("data-item-state"), node.textContent]);
  assertEquals(states, [
    ["changed", "Changed in a newer version"],
    ["missing", "Section gone"],
    ["unverified", "Couldn't check"],
  ]);
  const price = item(watch, "Price list");
  expand(price);
  await flush();
  click(find(price, "[data-open-after]"));
  click(find(price, "[data-open-before]"));
  assertEquals(reads, [["doc_3", "ver_9", null], ["doc_3", "ver_8", null]]);
  const receipts = item(watch, "Receipts");
  expand(receipts);
  await flush();
  assert(receipts.querySelector("[data-watch-missing]"));
  // 미확인은 변화가 아니고 이유를 보인다.
  const notes = item(watch, "Shop notes");
  expand(notes);
  await flush();
  assertEquals(
    find(notes, "[data-watch-reason]").textContent,
    "The format changed, so the parts can't be compared.",
  );
  assertEquals(notes.querySelector("[data-open-after]"), null);
  const pantry = item(watch, "Pantry/list_items");
  expand(pantry);
  await flush();
  assert(
    pantry.textContent!.includes(
      "App data isn't checked for changes automatically.",
    ),
  );
});

Deno.test("shell/desktop#R28: watch 결과를 읽지 못하면 변화 없음으로 보이지 않고 확인 못함을 알린다", async () => {
  const { view } = await open({ watch: { ok: false, code: "unavailable" } });
  using _view = view;
  assert(view.container.querySelector("[data-watch-unavailable]"));
  const states = [...view.container.querySelectorAll("[data-item-state]")]
    .map((node) => node.getAttribute("data-item-state"));
  assert(!states.includes("quiet"));
  assert(states.includes("unread"));
});

Deno.test("shell/desktop#R28: Focus 보관은 Focus만 치우고 문서·앱은 그대로라고 알린다", async () => {
  let archived = false;
  const fake = fakeContexts();
  const source = {
    ...fake.source,
    focus: (id: string) =>
      fake.source.focus(id).then((result) =>
        result.ok
          ? { ok: true as const, value: { ...result.value, archived } }
          : result
      ),
    setArchived: (
      focus: { id: string; revision: string },
      next: boolean,
    ) => {
      archived = next;
      return fake.source.setArchived(focus, next);
    },
  };
  using view = render(
    <ContextsScreen
      source={source}
      initialFocus={FOCUS.id}
      onRead={() => {}}
    />,
  );
  await flush();
  click(find(view.container, "[data-archive-focus='archive']"));
  await flush();
  assertEquals(fake.of("setArchived")[0]!.args, [
    { ...FOCUS, archived: false },
    true,
  ]);
  assertEquals(
    find(view.container, "[data-focus-archived]").textContent,
    "This focus is archived. Changes aren't followed while it's archived, and its documents and apps are unchanged.",
  );
  assert(view.container.querySelector("[data-archive-focus='unarchive']"));
});

Deno.test("shell/desktop#R28: Meaning은 사람이 정한 뜻과 미정 후보를 나누고 근거를 최대 5개 보이며 뜻을 미리 채우지 않는다", async () => {
  const { view, of, reads } = await open();
  using _view = view;
  pressTab(byText(view.container, "Meanings"));
  await flush();
  const definitions = find(view.container, "[data-definitions]");
  assertEquals(
    find(definitions, "[data-definition]").textContent,
    "Any meal we pay someone else to cook.",
  );
  const candidate = find(view.container, `[data-candidate='${CANDIDATE.id}']`);
  assertEquals(
    candidate.querySelectorAll("[data-evidence-row]").length,
    5,
  );
  assertEquals(
    find(candidate, "[data-evidence-more]").textContent,
    "1 more place",
  );
  const first = candidate.querySelectorAll("[data-evidence-row]")[0]!;
  assertEquals(first.textContent, "Budget planSection food");
  assertEquals(
    candidate.querySelectorAll("[data-evidence-row]")[1]!.textContent,
    "UntitledLines 3–4",
  );
  click(first);
  assertEquals(reads, [["doc_1", "ver_1", "food"]]);
  // 미루면 정의 command를 보내지 않는다.
  click(find(candidate, "[data-later]"));
  await flush();
  assert(candidate.querySelector("[data-deferred]"));
  assertEquals(of("define").length, 0);
  // 정하기: 이름은 후보 이름, 뜻은 빈 칸에서 사람이 쓴다.
  click(find(candidate, "[data-decide]"));
  await flush();
  const form = find(candidate, "[data-meaning-form]");
  assertEquals(
    (find(form, "[data-meaning-name]") as HTMLInputElement).value,
    "staples",
  );
  const definition = find(
    form,
    "[data-meaning-definition]",
  ) as HTMLTextAreaElement;
  assertEquals(definition.value, "");
  assert(
    (find(form, "[data-save-meaning]") as HTMLButtonElement).disabled,
  );
  typeText(definition, "Things we always keep at home.");
  await flush();
  submit(form);
  await flush();
  const input = of("define")[0]!.args[0] as MeaningInput;
  assertEquals(input.focus, FOCUS.id);
  assertEquals(input.term?.id, CANDIDATE.id);
  assertEquals(input.name, "staples");
  assertEquals(input.definition, "Things we always keep at home.");
  assertEquals(of("meanings").length, 2);
});

Deno.test("shell/desktop#R28: 정의 중 후보가 바뀌었으면 옛 내용으로 덮지 않고 최신을 다시 읽는다", async () => {
  const { view, of } = await open({
    define: { ok: false, code: "conflict" },
  });
  using _view = view;
  pressTab(byText(view.container, "Meanings"));
  await flush();
  const candidate = find(view.container, `[data-candidate='${CANDIDATE.id}']`);
  click(find(candidate, "[data-decide]"));
  await flush();
  typeText(find(candidate, "[data-meaning-definition]"), "Basics.");
  await flush();
  submit(find(candidate, "[data-meaning-form]"));
  await flush();
  assert(view.container.querySelector("[data-meaning-changed]"));
  assertEquals(of("meanings").length, 2);
});

Deno.test("shell/desktop#R28: export는 JSON을 Markdown으로 그려 사람이 고른 곳에 저장한다", async () => {
  const { view, of, saved } = await open();
  using _view = view;
  click(find(view.container, "[data-export-focus]"));
  await flush();
  assertEquals(of("exportFocus")[0]!.args, [FOCUS.id]);
  assertEquals(saved.length, 1);
  const [name, text] = saved[0]!;
  assertEquals(name, "Grocery budget.md");
  assertEquals(
    text,
    [
      "# Focus: Grocery budget",
      "",
      FOCUS.purpose,
      "",
      "## Baseline",
      "",
      "- Budget plan",
      "  - Why it's here: The plan we agreed on.",
      "  - Version read: `ver_2`",
      "",
      "## Reference",
      "",
      "Nothing here yet.",
      "",
      "## Follow changes",
      "",
      "- Pantry/list_items (app data)",
      "  - Why it's here: What is in the pantry.",
      "",
      "## Meanings",
      "",
      "- **eating out**: Any meal we pay someone else to cook.",
      "",
    ].join("\n"),
  );
});

Deno.test("shell/desktop#R28: Focus가 없으면 한 문장과 대화 열기 행동 하나를 보인다", async () => {
  const { view, asked } = await open({ rows: [] });
  using _view = view;
  click(byText(view.container, "Ask in conversation"));
  assertEquals(asked(), 1);
});

Deno.test("shell/desktop#R28: lophn 공간은 고른 Focus로 contexts를 열고 항목을 열면 documents에서 그 판을 읽는다", async () => {
  const { source } = fakeSource();
  const contexts = fakeContexts();
  using view = render(
    <LophnSpace
      source={source}
      contexts={contexts.source}
      screen="contexts"
      initialFocus={FOCUS.id}
      windowWidth={1440}
      onLauncher={() => {}}
    />,
  );
  await flush();
  assert(view.container.querySelector("[data-screen-body='contexts']"));
  assertEquals(contexts.of("focus")[0]!.args, [FOCUS.id]);
  const plan = item(view.container, "Budget plan");
  expand(plan);
  await flush();
  click(find(plan, "[data-open-item]"));
  await flush();
  assertEquals(
    find(view.container, "[data-space='lophn']").getAttribute(
      "data-current-screen",
    ),
    "documents",
  );
});

Deno.test("shell/desktop#R7: 연결 전에 읽지 못한 contexts는 연결이 준비되면 다시 읽고 보이던 것을 비우지 않는다", async () => {
  let up = false;
  const fake = fakeContexts();
  const source = {
    ...fake.source,
    list: (status: "active" | "all") =>
      up
        ? fake.source.list(status)
        : Promise.resolve({ ok: false as const, code: "unavailable" }),
    focus: (id: string) =>
      up
        ? fake.source.focus(id)
        : Promise.resolve({ ok: false as const, code: "unavailable" }),
  };
  const screen = (connected: number) => (
    <ContextsScreen
      source={source}
      initialFocus={FOCUS.id}
      connected={connected}
      onRead={() => {}}
    />
  );
  using view = render(screen(0));
  await flush();
  assertEquals(view.container.querySelector("[data-focus-head]"), null);
  up = true;
  view.rerender(screen(1));
  await flush();
  assert(view.container.querySelector("[data-focus-head]"));
  assert(view.container.querySelector(`[data-focus='${FOCUS.id}']`));
  // 다시 준비돼도 읽는 동안 보이던 Focus를 비우지 않는다.
  view.rerender(screen(2));
  assert(view.container.querySelector("[data-focus-head]"));
  await flush();
  assertEquals(fake.of("focus").length, 2);
});
