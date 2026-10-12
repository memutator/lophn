import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import {
  installOsEntry,
  type OsEntryEnv,
  removeOsEntry,
} from "./os-entry/entry.ts";
import type { ShortcutOptions } from "./os-entry/windows.ts";

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const LINUX_EXEC = "/opt/lophn/lophn-desktop";
const MAC_EXEC = "/Applications/lophn.app/Contents/MacOS/lophn";
const WIN_EXEC = "C:\\Program Files\\lophn\\lophn.exe";
// 앱 기록에 있지만 바로가기에 들어가면 안 되는 값.
const SOURCE = "/home/person/apps/notes/src/main.ts";
const TOKEN = "secret-token-value";

function fakeEnv(overrides: Partial<OsEntryEnv> = {}) {
  const written = new Map<string, { data: string; mode: number }>();
  const links = new Map<string, ShortcutOptions>();
  const removed: string[] = [];
  const env: OsEntryEnv = {
    platform: "linux",
    packaged: true,
    headless: false,
    execPath: LINUX_EXEC,
    home: "/fixture-home",
    dataHome: "/fixture-home/.local/share",
    appData: "C:\\Users\\person\\AppData\\Roaming",
    probe: {
      isExecutableFile: (path) =>
        [LINUX_EXEC, MAC_EXEC, WIN_EXEC].includes(path),
    },
    files: {
      write: (path, data, mode) => void written.set(path, { data, mode }),
      remove: (path) => void removed.push(path),
    },
    shortcuts: {
      write: (path, options) => {
        links.set(path, options);
        return true;
      },
    },
    ...overrides,
  };
  return { env, written, links, removed };
}

const notes = { id: APP, name: "Notes" };

function assertNoSecrets(text: string): void {
  for (const value of [SOURCE, TOKEN, "127.0.0.1", "localhost", "deno"]) {
    assert.equal(text.includes(value), false, value);
  }
}

test("shell/desktop#R14: Linux .desktop은 검증된 실행 경로와 --open-app <앱 ID>만 Exec에 둔다", () => {
  const { env, written } = fakeEnv();
  const result = installOsEntry(env, notes);
  const path = "/fixture-home/.local/share/applications/lophn-" + APP +
    ".desktop";
  assert.deepEqual(result, { ok: true, path });
  assert.deepEqual([...written.keys()], [path]);
  const entry = written.get(path)!;
  assert.equal(entry.mode, 0o644);
  const lines = entry.data.split("\n");
  assert.deepEqual(lines.filter((line) => line.startsWith("Exec=")), [
    `Exec="${LINUX_EXEC}" --open-app ${APP}`,
  ]);
  assert.ok(lines.includes("Name=Notes"));
  assertNoSecrets(entry.data);
  // 이름의 줄바꿈은 새 key가 되지 못한다.
  const tricky = fakeEnv();
  installOsEntry(tricky.env, {
    id: APP,
    name: `Notes\nExec=/bin/sh -c "curl ${TOKEN}"`,
  });
  const data = tricky.written.get(path)!.data;
  assert.deepEqual(
    data.split("\n").filter((line) => line.startsWith("Exec=")),
    [`Exec="${LINUX_EXEC}" --open-app ${APP}`],
  );
});

test("shell/desktop#R14: macOS app bundle의 실행 파일은 lophn을 --open-app <앱 ID>로 exec할 뿐이다", () => {
  const { env, written } = fakeEnv({
    platform: "darwin",
    execPath: MAC_EXEC,
  });
  const bundle = `/fixture-home/Applications/lophn-${APP}.app`;
  assert.deepEqual(installOsEntry(env, { id: APP, name: "Notes & <Tasks>" }), {
    ok: true,
    path: bundle,
  });
  const script = written.get(join(bundle, "Contents", "MacOS", "open-app"))!;
  assert.equal(script.mode, 0o755);
  assert.equal(
    script.data,
    `#!/bin/sh\nexec "${MAC_EXEC}" --open-app ${APP}\n`,
  );
  const plist = written.get(join(bundle, "Contents", "Info.plist"))!;
  assert.ok(plist.data.includes("<string>open-app</string>"));
  assert.ok(plist.data.includes("<string>Notes &amp; &lt;Tasks&gt;</string>"));
  assertNoSecrets(plist.data + script.data);
});

test("shell/desktop#R14: Windows shortcut은 lophn 실행 파일을 target으로 --open-app <앱 ID>만 인자로 둔다", () => {
  const { env, links, written } = fakeEnv({
    platform: "win32",
    execPath: WIN_EXEC,
  });
  const path =
    "C:\\Users\\person\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\lophn\\lophn-" +
    APP + ".lnk";
  assert.deepEqual(installOsEntry(env, notes), { ok: true, path });
  assert.deepEqual(links.get(path), {
    target: WIN_EXEC,
    args: `--open-app ${APP}`,
    description: "Notes",
    icon: WIN_EXEC,
    iconIndex: 0,
  });
  assert.equal(written.size, 0);
});

test("shell/desktop#R14: 개발 실행·headless·검증 안 된 경로·틀린 앱 ID는 OS에 아무것도 쓰지 않는다", () => {
  const cases: [Partial<OsEntryEnv>, string, string][] = [
    [{ packaged: false }, APP, "not_packaged"],
    [{ headless: true }, APP, "not_packaged"],
    [{ execPath: "/tmp/not-executable" }, APP, "unverified_path"],
    [{ execPath: "relative/lophn" }, APP, "unverified_path"],
    [
      {
        platform: "darwin",
        execPath: "/Applications/$(id).app/lophn",
        probe: { isExecutableFile: () => true },
      },
      APP,
      "unverified_path",
    ],
    [{}, "app_bad", "invalid_app"],
    [{}, `${APP}/../x`, "invalid_app"],
    [{ platform: "freebsd" }, APP, "unsupported"],
  ];
  for (const [overrides, id, reason] of cases) {
    const { env, written, links } = fakeEnv(overrides);
    assert.deepEqual(installOsEntry(env, { id, name: "Notes" }), {
      ok: false,
      reason,
    });
    assert.equal(written.size + links.size, 0, reason);
  }
});

test("shell/desktop#R14: 앱 바로가기 제거는 그 앱 ID의 등록 자리만 지운다", () => {
  const { env, removed } = fakeEnv({ platform: "darwin", execPath: MAC_EXEC });
  const bundle = `/fixture-home/Applications/lophn-${APP}.app`;
  assert.deepEqual(removeOsEntry(env, APP), { ok: true, path: bundle });
  assert.deepEqual(removeOsEntry(env, "../Applications"), {
    ok: false,
    reason: "invalid_app",
  });
  assert.deepEqual(removed, [bundle]);
});
