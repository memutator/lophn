// series 새 멤버 쓰기(shell#T17, flow write-series 2·5): 이 key로 쓰기는 가족 draft를 세우고 같은
// 편집기로 쓰며, 편집 종료가 첫 판을 만든다(그 저장이 멤버 가입과 draft 비움을 한다). 그 전에는
// draft로 보이고 판 확정과 따로 보인다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  render,
  unmountSettled,
} from "../../../../../../packages/design/components/testing.ts";

import type {
  CreateReport,
  EditorCreate,
  EditorFilesApi,
  EditorReply,
} from "../../../../ipc/editor.ts";
import { EditorSessions } from "../../../editor/sessions.ts";
import { appendText } from "../../../editor/testing.ts";
import { DocumentsScreen } from "../documents/documents-screen.tsx";
import type { Series } from "../source.ts";
import { fakeSource, SERIES } from "../testdata/fake-source.ts";
import { find, flush, typeInto } from "../testdata/dom.ts";

const V1 = "ver_01kq12a1pha000000000000001";
const DRAFTED: Series = {
  ...SERIES,
  revision: "10",
  draft: { document: "doc_new", key: "week-3" },
};

function sessionsOf(replies: EditorReply<CreateReport>[]) {
  const created: EditorCreate[] = [];
  const unavailable = () =>
    Promise.resolve({ ok: false as const, code: "unavailable" as const });
  const api: EditorFilesApi = {
    open: unavailable,
    write: unavailable,
    lookup: unavailable,
    current: unavailable,
    watch: unavailable,
    restore: unavailable,
    place: unavailable,
    create: (input) => {
      created.push(input);
      return Promise.resolve(replies.shift()!);
    },
    release: () => Promise.resolve(),
    counts: () => {},
    onCloseRequest: () => () => {},
    answerClose: () => {},
  };
  const sessions = new EditorSessions(api, {
    ask: () => Promise.resolve("keep"),
  });
  return { sessions, created };
}

function typeText(container: HTMLElement, text: string): void {
  act(() => appendText(find(container, ".cm-editor"), text));
}

function ctrlS(target: Element): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

Deno.test("documents/series#R11 shell/editor#R2 shell/editor#R12: 이 key로 쓰기는 가족 draft를 세우고, 쓴 글은 저장 버튼 없이 편집 종료에 첫 판이 되며 그 전에는 draft로 보인다", async () => {
  const { sessions, created } = sessionsOf([{
    ok: true,
    value: { outcome: "saved", version: V1, failure: null },
  }]);
  const fake = fakeSource({
    seriesList: [{ ...SERIES, members: 0 }],
    series: () => ({
      ok: true,
      value: {
        series: fake.of("startDraft").length > 0 ? DRAFTED : SERIES,
        members: [],
      },
    }),
    next: { key: "week-3", from: "week-2", taken: false },
    drafted: { ok: true, value: DRAFTED },
  });
  const view = render(
    <DocumentsScreen
      source={fake.source}
      now={() => 0}
      initialTab="series"
      sessions={sessions}
    />,
  );
  await flush();
  click(find(view.container, "[data-series='ser_1']"));
  await flush();
  click(find(view.container, "[data-write-member]"));
  await flush();
  const [series, key] = fake.of("startDraft")[0]!.args as [Series, string];
  assertEquals(series.revision, "7");
  assertEquals(key, "week-3");
  // 첫 판 전에는 draft다. 판 확정과 다른 상태로 보인다.
  const writer = find(view.container, "[data-member-writer='week-3']");
  assertEquals(
    find(view.container, "[data-draft-document]").getAttribute(
      "data-draft-document",
    ),
    "draft",
  );
  assertEquals(
    find(view.container, "[data-draft-document]").textContent,
    "Not saved yet. Finish editing to keep it.",
  );
  // 저장 버튼은 없다.
  assertEquals(view.container.querySelector("[data-save]"), null);
  typeText(view.container, "Third week.\n");
  await flush();
  assertEquals(created.length, 0);

  ctrlS(writer);
  await flush();
  await flush();
  assertEquals(created.length, 1);
  assertEquals(created[0]!.document, "doc_new");
  assertEquals(created[0]!.title, "week-3");
  assertEquals(created[0]!.name, "week-3");
  assertEquals(created[0]!.place, SERIES.place);
  assertEquals(
    new TextDecoder().decode(created[0]!.bytes),
    "# week-3\n\nThird week.\n",
  );
  // 첫 판이 멤버가 되었다. 가족으로 돌아가 다시 읽는다.
  assert(view.container.querySelector("[data-series-head='ser_1']"));
  assertEquals(view.container.querySelector("[data-member-writer]"), null);
  await unmountSettled(view);
});

Deno.test("documents/series#R11: draft가 있는 가족은 이어 쓰고, 버리면 가족 draft를 비운다", async () => {
  const { sessions, created } = sessionsOf([]);
  const fake = fakeSource({
    seriesList: [{ ...DRAFTED, members: 0 }],
    series: () => ({
      ok: true,
      value: {
        series: fake.of("clearDraft").length > 0
          ? { ...DRAFTED, draft: null }
          : DRAFTED,
        members: [],
      },
    }),
  });
  const view = render(
    <DocumentsScreen
      source={fake.source}
      now={() => 0}
      initialTab="series"
      sessions={sessions}
    />,
  );
  await flush();
  click(find(view.container, "[data-series='ser_1']"));
  await flush();
  assertEquals(
    find(view.container, "[data-series-draft='week-3']").textContent?.includes(
      "You're writing week-3.",
    ),
    true,
  );
  // draft가 있으면 새로 세우지 않는다.
  assertEquals(view.container.querySelector("[data-write-member]"), null);
  click(find(view.container, "[data-continue-draft]"));
  await flush();
  assert(view.container.querySelector("[data-member-writer='week-3']"));
  click(find(view.container, "[data-discard-draft]"));
  await flush();
  await flush();
  assertEquals(fake.of("clearDraft").length, 1);
  assertEquals(created.length, 0);
  assert(view.container.querySelector("[data-series-head='ser_1']"));
  await unmountSettled(view);
});

Deno.test("documents/series#R2: 문서 이름이 될 수 없는 key는 draft를 세우지 않고 알린다", async () => {
  const { sessions } = sessionsOf([]);
  const fake = fakeSource({ seriesList: [{ ...SERIES, members: 0 }] });
  const view = render(
    <DocumentsScreen
      source={fake.source}
      now={() => 0}
      initialTab="series"
      sessions={sessions}
    />,
  );
  await flush();
  click(find(view.container, "[data-series='ser_1']"));
  await flush();
  typeInto(find(view.container, "[data-member-key]"), "보고");
  await flush();
  click(find(view.container, "[data-write-member]"));
  await flush();
  assertEquals(fake.of("startDraft").length, 0);
  assert(
    view.container.textContent?.includes(
      "lophn can't name a document from this key.",
    ),
  );
  await unmountSettled(view);
});
