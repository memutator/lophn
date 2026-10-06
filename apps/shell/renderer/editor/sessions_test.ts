import { assert, assertEquals } from "@std/assert";

import type {
  CloseAnswer,
  EditorCounts,
  EditorFilesApi,
  EditorReply,
  SaveReport,
} from "../../ipc/editor.ts";
import { EditorSessions, type LeaveChoice } from "./sessions.ts";

const DOC = "doc_01kq12a1pha000000000000000";
const DOC2 = "doc_01kq12a1pha000000000000001";

function report(over: Partial<SaveReport> = {}): SaveReport {
  return {
    disk: "written",
    written_hash: "a".repeat(64),
    observed_hash: null,
    observed_at: null,
    changed_again: false,
    recording: "recorded",
    version: null,
    saved_version: null,
    latest_version: null,
    problems: null,
    failure: null,
    ...over,
  };
}

function fakeApi(write: () => EditorReply<SaveReport>) {
  const counts: EditorCounts[] = [];
  const released: string[] = [];
  const writes: { session: string; end: boolean }[] = [];
  const answers: [number, CloseAnswer][] = [];
  let closeListener: ((request: number) => void) | undefined;
  let opened = 0;
  const api: EditorFilesApi = {
    open: () => {
      opened += 1;
      return Promise.resolve({
        ok: true,
        value: {
          session: `es_session${opened}x`,
          text: "start",
          base_hash: "0".repeat(64),
          target: "project_file",
          primary_path: "plan.md",
        },
      });
    },
    write: (input) => {
      writes.push({ session: input.session, end: input.end });
      return Promise.resolve(write());
    },
    lookup: () =>
      Promise.resolve({
        ok: true,
        value: { state: "unknown", observed_hash: null, observed_at: null },
      }),
    current: () =>
      Promise.resolve({ ok: true, value: { text: "x", hash: null } }),
    watch: () => Promise.resolve({ ok: false, code: "unavailable" }),
    restore: () => Promise.resolve({ ok: false, code: "unavailable" }),
    place: () => Promise.resolve({ ok: false, code: "unavailable" }),
    release: (input) => {
      released.push(input.session);
      return Promise.resolve();
    },
    counts: (input) => counts.push(input),
    onCloseRequest: (listener) => {
      closeListener = listener;
      return () => (closeListener = undefined);
    },
    answerClose: (request, answer) => answers.push([request, answer]),
  };
  return {
    api,
    counts,
    released,
    writes,
    answers,
    requestClose: (request: number) => closeListener?.(request),
  };
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

Deno.test("shell/editor#R1: 탭 닫기는 마지막 고침을 편집 종료로 보내고, 저장이 끝났으면 묻지 않고 닫는다", async () => {
  const fake = fakeApi(() => ({ ok: true, value: report() }));
  const ask = asker([]);
  const sessions = new EditorSessions(fake.api, ask.asker);
  const opened = await sessions.attach(DOC, "plan.md");
  assert(typeof opened !== "string");
  opened.session.edit("changed");
  assertEquals(sessions.counts(), { unsettled: 1, open: 0 });
  assert(await sessions.leave(DOC));
  assertEquals(fake.writes, [{ session: "es_session1x", end: true }]);
  assertEquals(ask.asked, []);
  assertEquals(sessions.counts(), { unsettled: 0, open: 0 });
  // 화면이 떠나면 main session을 놓는다.
  sessions.detach(DOC);
  await tick();
  assertEquals(fake.released, ["es_session1x"]);
  assertEquals(fake.counts.at(-1), { unsettled: 0, open: 0 });
});

Deno.test("shell/editor#R1: 쓰기 실패가 남으면 탭 닫기를 막고 계속 편집·다시 확인·명시 폐기를 고르게 한다", async () => {
  const fake = fakeApi(() => ({
    ok: true,
    value: report({ disk: "conflict", failure: "conflict" }),
  }));
  const ask = asker(["keep", "check", "discard"]);
  const sessions = new EditorSessions(fake.api, ask.asker);
  const opened = await sessions.attach(DOC, "plan.md");
  assert(typeof opened !== "string");
  opened.session.edit("mine");
  // 계속 편집: 탭을 남긴다.
  assertEquals(await sessions.leave(DOC), false);
  assertEquals(ask.asked, ["plan.md"]);
  assertEquals(opened.session.text, "mine");
  // 다시 확인 뒤에도 남으면 또 묻고, 명시 폐기를 고르면 닫는다.
  assertEquals(await sessions.leave(DOC), true);
  assertEquals(ask.asked, ["plan.md", "plan.md", "plan.md"]);
  assertEquals(sessions.counts(), { unsettled: 0, open: 0 });
});

Deno.test("shell/editor#R1: 탭이 사라져도 끝나지 않은 저장은 창이 세고, 같은 문서를 다시 열면 그 초안을 잇는다", async () => {
  const fake = fakeApi(() => ({
    ok: true,
    value: report({ disk: "failed", failure: "unavailable" }),
  }));
  const sessions = new EditorSessions(fake.api, asker([]).asker);
  const opened = await sessions.attach(DOC, "plan.md");
  assert(typeof opened !== "string");
  opened.session.edit("kept draft");
  sessions.detach(DOC);
  await tick();
  assertEquals(fake.released, []);
  assertEquals(sessions.counts().unsettled, 1);
  const again = await sessions.attach(DOC, "plan.md");
  assert(typeof again !== "string");
  assertEquals(again.session.text, "kept draft");
  assertEquals(again.handle, "es_session1x");
  opened.session.discard();
});

Deno.test("shell/editor#R1: 창 닫기는 모든 문서의 편집을 끝내고, 남으면 묻는 중이라고 main에 알린 뒤 사람의 답을 돌려준다", async () => {
  let fail = true;
  const fake = fakeApi(() =>
    fail
      ? { ok: true, value: report({ disk: "failed", failure: "unavailable" }) }
      : { ok: true, value: report() }
  );
  const ask = asker(["keep", "discard"]);
  const sessions = new EditorSessions(fake.api, ask.asker);
  sessions.listen();
  const first = await sessions.attach(DOC, "plan.md");
  const second = await sessions.attach(DOC2, "notes.md");
  assert(typeof first !== "string" && typeof second !== "string");
  first.session.edit("one");
  second.session.edit("two");
  fake.requestClose(4);
  for (let i = 0; i < 5; i += 1) await tick();
  // 둘 다 남아 한 번에 묻는다(이름 없이). 계속 편집이면 stay다.
  assertEquals(ask.asked, [null]);
  assertEquals(fake.answers, [[4, "asking"], [4, "stay"]]);
  // 저장이 되면 묻지 않고 allow다.
  fail = false;
  first.session.retry();
  second.session.retry();
  for (let i = 0; i < 5; i += 1) await tick();
  assertEquals(await sessions.closeWindow(), "allow");
  assertEquals(ask.asked, [null]);
  sessions.dispose();
});

Deno.test("shell/editor#R1: 편집 종료가 남은 문서 수와 저장 중 문서 수를 따로 main에 알린다", async () => {
  const fake = fakeApi(() => ({ ok: true, value: report() }));
  const sessions = new EditorSessions(fake.api, asker([]).asker);
  const opened = await sessions.attach(DOC, "plan.md");
  assert(typeof opened !== "string");
  opened.session.edit("autosaved");
  await opened.session.flush(false);
  assertEquals(sessions.counts(), { unsettled: 0, open: 1 });
  assertEquals(fake.counts.at(-1), { unsettled: 0, open: 1 });
  await opened.session.flush(true);
  assertEquals(fake.counts.at(-1), { unsettled: 0, open: 0 });
});
