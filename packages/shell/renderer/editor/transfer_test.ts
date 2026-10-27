import assert from "node:assert/strict";
import { test } from "node:test";

import type { FileReply, FileText, FileWritten } from "../../ipc/files.ts";
import { EditorSessions } from "./sessions.ts";
import type { EditorFiles } from "./source.ts";
import { transferEditor } from "./transfer.ts";

const PATH = "/work/a.md";

// 쓰기만 성패를 고르는 파일 통로. 나머지는 이 test가 쓰지 않는다.
function sessionsOf(writeOk: boolean): EditorSessions {
  const files = {
    read: (): Promise<FileReply<FileText>> =>
      Promise.resolve({
        ok: true,
        value: { text: "old", hash: "h0", modified_at: 0 },
      }),
    write: (): Promise<FileReply<FileWritten>> =>
      Promise.resolve(
        writeOk
          ? { ok: true, value: { hash: "h1" } }
          : { ok: false, code: "forbidden" },
      ),
    watch: () => Promise.resolve({ ok: true, value: {} }),
    counts: () => {},
  } as unknown as EditorFiles;
  return new EditorSessions(files, { ask: () => Promise.resolve("keep") });
}

async function edited(sessions: EditorSessions) {
  const opened = await sessions.attach(PATH, "a.md", false);
  assert(typeof opened !== "string");
  opened.session.edit("new");
  return opened.session;
}

test("transferEditor: a failed write keeps the tab and the text in the session", async () => {
  const sessions = sessionsOf(false);
  const session = await edited(sessions);
  assert.deepStrictEqual(await transferEditor(sessions, PATH), null);
  assert.ok(sessions.isUnsettled(PATH));
  assert.deepStrictEqual(session.text, "new");
});

test("transferEditor: moves once the text is on disk", async () => {
  const sessions = sessionsOf(true);
  await edited(sessions);
  assert.deepStrictEqual(await transferEditor(sessions, PATH), {
    value: null,
    views: [],
  });
  assert.ok(!sessions.isUnsettled(PATH));
});
