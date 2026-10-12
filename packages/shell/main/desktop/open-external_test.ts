import assert from "node:assert/strict";
import { test } from "node:test";

import { createOpenExternal } from "./open-external.ts";
import {
  type CallerContents,
  ContentsRegistry,
  type IpcEvent,
} from "./ipc-guard.ts";

function sender(id: number, url: string): CallerContents {
  return { id, isDestroyed: () => false, mainFrame: { url, parent: null } };
}

function eventOf(contents: CallerContents): IpcEvent {
  return { sender: contents, senderFrame: contents.mainFrame };
}

const desktop = sender(1, "lophn-shell://desktop/index.html");
const overlay = sender(2, "lophn-shell://overlay/index.html");

function registry(): ContentsRegistry {
  const table = new ContentsRegistry();
  table.register({
    contents: desktop,
    origin: { scheme: "lophn-shell", host: "desktop", path: "/index.html" },
  });
  table.register({
    contents: overlay,
    origin: { scheme: "lophn-shell", host: "overlay", path: "/index.html" },
  });
  return table;
}

function harness(fail = false) {
  const opened: string[] = [];
  const lines: string[] = [];
  const open = createOpenExternal({
    registry: registry(),
    open(url) {
      opened.push(url);
      return fail ? Promise.reject(new Error("no browser")) : Promise.resolve();
    },
    log: (line) => lines.push(line),
  });
  return { open, opened, lines };
}

test("shell/app-frame#R7: shell 크롬의 외부 링크는 확인 없이 OS browser로 열고 기록에는 origin·path만 남긴다", async () => {
  const { open, opened, lines } = harness();
  const url = "https://auth.example.com/login?state=SECRET-STATE#frag-secret";
  assert.deepEqual(await open(eventOf(desktop), { url }), { ok: true });
  assert.deepEqual(opened, [url]);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /origin=https:\/\/auth\.example\.com path=\/login$/);
  assert.equal(lines.join("\n").includes("SECRET-STATE"), false);
  assert.equal(lines.join("\n").includes("frag-secret"), false);

  const plain = "http://localhost:8123/docs";
  assert.deepEqual(await open(eventOf(desktop), { url: plain }), { ok: true });
  assert.equal(opened.at(-1), plain);
});

test("shell/app-frame#R7: 다른 scheme·userinfo·8,193자 URL과 모르는 입력은 아무것도 열지 않는다", async () => {
  const { open, opened } = harness();
  const long = `https://example.com/${"a".repeat(8_192 - 20)}`;
  assert.equal(long.length, 8_192);
  assert.deepEqual(await open(eventOf(desktop), { url: long }), { ok: true });
  assert.equal(opened.length, 1);
  const tooLong = `${long}a`;
  const rejected = [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "lophn-shell://desktop/index.html",
    "https://user:pass@example.com/",
    "https://user@example.com/",
    tooLong,
    "not a url",
  ];
  for (const url of rejected) {
    assert.deepEqual(await open(eventOf(desktop), { url }), {
      ok: false,
      code: "invalid_input",
    });
  }
  assert.deepEqual(
    await open(eventOf(desktop), { url: "https://example.com", extra: 1 }),
    { ok: false, code: "invalid_input" },
  );
  assert.deepEqual(await open(eventOf(desktop), "https://example.com"), {
    ok: false,
    code: "invalid_input",
  });
  assert.equal(opened.length, 1);
});

test("shell/app-frame#R7: overlay와 모르는 sender는 shell 링크를 열지 못하고 열기 실패는 unavailable이다", async () => {
  const { open, opened } = harness();
  const url = "https://example.com/";
  assert.deepEqual(await open(eventOf(overlay), { url }), {
    ok: false,
    code: "forbidden",
  });
  assert.deepEqual(
    await open(eventOf(sender(9, "lophn-shell://desktop/index.html")), { url }),
    { ok: false, code: "forbidden" },
  );
  assert.deepEqual(opened, []);

  const broken = harness(true);
  assert.deepEqual(await broken.open(eventOf(desktop), { url }), {
    ok: false,
    code: "unavailable",
  });
  assert.match(broken.lines[0]!, /not opened origin=https:\/\/example\.com/);
});
