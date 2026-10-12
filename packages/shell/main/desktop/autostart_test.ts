import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  type AutostartOs,
  autostartPath,
  desktopEntry,
  nodeAutostartFiles,
  readAutostart,
  verifiedExecPath,
  writeAutostart,
} from "./autostart.ts";

const EXEC = "/opt/lophn/lophn-desktop";
const CONFIG = "/fixture-home/.config";

function fakeOs(overrides: Partial<AutostartOs> = {}): AutostartOs & {
  written: Map<string, string>;
  loginCalls: unknown[];
} {
  const written = new Map<string, string>();
  const loginCalls: unknown[] = [];
  let openAtLogin = false;
  return {
    platform: "linux",
    packaged: true,
    execPath: EXEC,
    configHome: CONFIG,
    probe: { isExecutableFile: (path) => path === EXEC },
    files: {
      read: (path) => written.get(path),
      write: (path, data) => void written.set(path, data),
      remove: (path) => void written.delete(path),
    },
    loginItems: {
      get: () => ({ openAtLogin }),
      set: (settings) => {
        loginCalls.push(settings);
        openAtLogin = settings.openAtLogin;
      },
    },
    ...overrides,
    written,
    loginCalls,
  };
}

test("shell/desktop#R21: Linux 자동 시작은 검증된 실행 경로와 --tray만 XDG autostart에 등록한다", () => {
  const os = fakeOs();
  const state = writeAutostart(os, true);
  assert.deepEqual(state, { available: true, enabled: true });
  const file = join(CONFIG, "autostart", "lophn.desktop");
  assert.deepEqual([...os.written.keys()], [file]);
  const entry = os.written.get(file)!;
  const exec = entry.split("\n").filter((line) => line.startsWith("Exec="));
  assert.deepEqual(exec, [`Exec="${EXEC}" --tray`]);
  assert.equal(entry, desktopEntry(EXEC));
  assert.equal(os.loginCalls.length, 0);
});

test("shell/desktop#R21: 자동 시작을 끄면 XDG autostart entry를 지운다", () => {
  const os = fakeOs();
  writeAutostart(os, true);
  assert.deepEqual(writeAutostart(os, false), {
    available: true,
    enabled: false,
  });
  assert.equal(os.written.size, 0);
});

test("shell/desktop#R21: 다른 경로·intent의 옛 entry는 켜진 것으로 보지 않는다", () => {
  const os = fakeOs();
  os.written.set(autostartPath(CONFIG), desktopEntry("/old/lophn"));
  assert.deepEqual(readAutostart(os), { available: true, enabled: false });
  os.written.set(
    autostartPath(CONFIG),
    desktopEntry(EXEC).replace(" --tray", ""),
  );
  assert.deepEqual(readAutostart(os), { available: true, enabled: false });
});

test("shell/desktop#R21: 개발 실행은 자동 시작을 등록하지 않는다", () => {
  const os = fakeOs({ packaged: false });
  assert.deepEqual(writeAutostart(os, true), {
    available: false,
    enabled: false,
    reason: "not_packaged",
  });
  assert.equal(os.written.size, 0);
  assert.equal(os.loginCalls.length, 0);
});

test("shell/desktop#R21: 검증하지 못한 실행 경로는 등록하지 않는다", () => {
  const unsafe = [
    "relative/lophn",
    "/opt/lo\nphn",
    '/opt/lo"phn',
    "/opt/lo$phn",
    "/opt/lo%Uphn",
    "/opt/lo`phn",
    "/opt/lo\\phn",
  ];
  for (const execPath of unsafe) {
    const os = fakeOs({
      execPath,
      probe: { isExecutableFile: () => true },
    });
    assert.deepEqual(
      writeAutostart(os, true),
      { available: false, enabled: false, reason: "unverified_path" },
      execPath,
    );
    assert.equal(os.written.size, 0, execPath);
  }
  // 실행할 수 없는 파일(없음·디렉터리·권한 없음)도 거절한다.
  const missing = fakeOs({ probe: { isExecutableFile: () => false } });
  assert.equal(verifiedExecPath(missing).ok, false);
  assert.equal(writeAutostart(missing, true).enabled, false);
  assert.equal(missing.written.size, 0);
});

test("shell/desktop#R21: AppImage 실행은 임시 mount가 아니라 AppImage 파일을 등록한다", () => {
  const image = "/home/fixture/Apps/lophn.AppImage";
  const os = fakeOs({
    execPath: "/tmp/.mount_lophnX/lophn-desktop",
    appImage: image,
    probe: { isExecutableFile: (path) => path === image },
  });
  writeAutostart(os, true);
  assert.equal(
    os.written.get(autostartPath(CONFIG)),
    desktopEntry(image),
  );
});

test("shell/desktop#R11: Linux 밖은 login item에 실행 경로와 --tray를 등록한다", () => {
  for (const platform of ["win32", "darwin"] as const) {
    const execPath = platform === "win32"
      ? "C:\\Program Files\\lophn\\lophn.exe"
      : "/Applications/lophn.app/Contents/MacOS/lophn";
    const os = fakeOs({
      platform,
      execPath,
      probe: { isExecutableFile: (path) => path === execPath },
    });
    assert.deepEqual(writeAutostart(os, true), {
      available: true,
      enabled: true,
    });
    assert.deepEqual(os.loginCalls, [
      { openAtLogin: true, path: execPath, args: ["--tray"] },
    ]);
    assert.equal(os.written.size, 0);
    assert.deepEqual(writeAutostart(os, false), {
      available: true,
      enabled: false,
    });
  }
});

test("shell/desktop#R11: OS가 등록을 거절하면 켜진 것처럼 보이지 않는다", () => {
  const os = fakeOs({
    files: {
      read: () => undefined,
      write: () => {
        throw new Error("EACCES");
      },
      remove: () => {},
    },
    log: () => {},
  });
  assert.deepEqual(writeAutostart(os, true), {
    available: false,
    enabled: false,
    reason: "os_failed",
  });
});

test("shell/desktop#R21: XDG autostart 파일은 임시 home 안에서 원자적으로 쓰고 지운다", () => {
  const home = mkdtempSync(join(tmpdir(), "lophn-autostart-"));
  try {
    const file = autostartPath(join(home, ".config"));
    assert.equal(nodeAutostartFiles.read(file), undefined);
    nodeAutostartFiles.write(file, desktopEntry(EXEC));
    assert.equal(readFileSync(file, "utf8"), desktopEntry(EXEC));
    assert.equal(statSync(file).mode & 0o777, 0o644);
    nodeAutostartFiles.remove(file);
    nodeAutostartFiles.remove(file);
    assert.equal(nodeAutostartFiles.read(file), undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
