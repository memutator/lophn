// 판이 아직 없는 새 문서(series 새 멤버)도 창의 편집 session 묶음이 붙들어 창 닫기·끄기 확인이
// 센다(shell#T17, shell/editor#R1).
import { assert, assertEquals } from "@std/assert";

import type {
  CreateReport,
  EditorCounts,
  EditorFilesApi,
  EditorReply,
} from "../../ipc/editor.ts";
import { DraftDocumentSession } from "./draft-document.ts";
import { EditorSessions, type LeaveChoice } from "./sessions.ts";

const DOC = "doc_01kq12a1pha000000000000001";
const V1 = "ver_01kq12a1pha000000000000001";
const PROJECT = "prj_01kq12a1pha000000000000000";

function fakeApi(replies: EditorReply<CreateReport>[]) {
  const counts: EditorCounts[] = [];
  const created: string[] = [];
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
      created.push(new TextDecoder().decode(input.bytes));
      return Promise.resolve(replies.shift()!);
    },
    release: () => Promise.resolve(),
    counts: (input) => counts.push(input),
    onCloseRequest: () => () => {},
    answerClose: () => {},
  };
  return { api, counts, created };
}

function asker(choices: LeaveChoice[]) {
  const asked: (string | null)[] = [];
  return {
    asked,
    asker: {
      ask(name: string | null) {
        asked.push(name);
        return Promise.resolve(choices.shift() ?? "keep");
      },
    },
  };
}

function hold(sessions: EditorSessions): DraftDocumentSession {
  return sessions.holdDraft(DOC, "P003", () =>
    new DraftDocumentSession({
      text: "# P003\n\n",
      port: {
        create: (input) =>
          sessions.createDocument({
            document: DOC,
            request_key: input.request_key,
            title: "P003",
            place: { kind: "project", id: PROJECT },
            name: "p003",
            bytes: input.bytes,
          }),
        lookup: () => Promise.resolve(null),
      },
    }));
}

const saved: EditorReply<CreateReport> = {
  ok: true,
  value: { outcome: "saved", version: V1, failure: null },
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

Deno.test("shell/editor#R1: 판이 없는 새 문서도 창 닫기가 편집 종료로 첫 판을 만들고, 만들지 못하면 묻는다", async () => {
  const fake = fakeApi([
    {
      ok: true,
      value: { outcome: "failed", version: null, failure: "unavailable" },
    },
    saved,
  ]);
  const ask = asker(["check", "keep"]);
  const sessions = new EditorSessions(fake.api, ask.asker);
  const draft = hold(sessions);
  // 같은 문서를 다시 붙들면 같은 글을 이어 쓴다.
  assertEquals(hold(sessions), draft);
  draft.edit("# P003\n\nthird\n");
  assertEquals(sessions.counts(), { unsettled: 0, open: 1 });
  // 첫 판을 만들지 못하면 묻는다. 다시 확인은 남은 글을 다시 편집 종료로 보낸다.
  assertEquals(await sessions.closeWindow(), "allow");
  assertEquals(ask.asked, ["P003"]);
  assertEquals(fake.created, ["# P003\n\nthird\n", "# P003\n\nthird\n"]);
  assertEquals(draft.facts.state, "saved");
  assertEquals(sessions.counts(), { unsettled: 0, open: 0 });
});

Deno.test("shell/editor#R1: 새 문서 화면이 고친 글을 둔 채 떠나면 편집 종료로 첫 판을 만들고, 고친 글이 없으면 만들지 않는다", async () => {
  const fake = fakeApi([saved]);
  const sessions = new EditorSessions(fake.api, asker([]).asker);
  const draft = hold(sessions);
  draft.edit("# P003\n\nthird\n");
  sessions.releaseDraft(DOC);
  await tick();
  await tick();
  assertEquals(fake.created, ["# P003\n\nthird\n"]);
  assertEquals(fake.counts.at(-1), { unsettled: 0, open: 0 });

  // 고친 글 없이 떠나면 판을 만들지 않는다(가족 draft만 남는다).
  const untouched = fakeApi([]);
  const other = new EditorSessions(untouched.api, asker([]).asker);
  hold(other);
  other.releaseDraft(DOC);
  await tick();
  assertEquals(untouched.created, []);
  assert(other.counts().open === 0 && other.counts().unsettled === 0);
});
