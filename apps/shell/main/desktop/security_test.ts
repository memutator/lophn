import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  hardenContents,
  registerShellScheme,
  webPreferences,
} from "./security.ts";
import { createShellHandler, safeJoin, SHELL_CSP } from "./shell-protocol.ts";
import { shellApi } from "../../preload/shell-api.ts";

test("shell/app-frame#R3: 모든 view에 sandbox·context isolation·web security를 켜고 Node integration을 끈다", () => {
  for (const packaged of [false, true]) {
    const prefs = webPreferences(packaged);
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.webSecurity, true);
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.nodeIntegrationInSubFrames, false);
    assert.equal(prefs.nodeIntegrationInWorker, false);
  }
});

test("shell/app-frame#R4: 새 창·camera·location 요청은 거절하고 packaged build는 devtools를 연다", () => {
  for (const packaged of [false, true]) {
    const prefs = webPreferences(packaged);
    assert.equal(prefs.webviewTag, false);
    assert.equal(prefs.allowRunningInsecureContent, false);
    assert.equal(prefs.devTools, !packaged);
  }
  const denied: string[] = [];
  let closed = false;
  hardenContents(
    {
      setWindowOpenHandler: (handler) => {
        denied.push(handler().action);
      },
      onPermissionRequest: (handler) => {
        denied.push(String(handler("camera")));
        denied.push(String(handler("geolocation")));
      },
      onDevtoolsOpened: (handler) => handler(),
      closeDevTools: () => {
        closed = true;
      },
    },
    true,
  );
  assert.deepEqual(denied, ["deny", "false", "false"]);
  assert.equal(closed, true);
});

test("shell/desktop#R12: shell scheme은 secure·standard·fetch 지원으로 등록한다", () => {
  const registered: unknown[] = [];
  registerShellScheme({
    registerSchemesAsPrivileged: (schemes) => registered.push(...schemes),
  });
  assert.deepEqual(registered, [
    {
      scheme: "lophn-shell",
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
});

test("shell/desktop#R16: shell preload는 contextBridge 값만 노출하고 ipcRenderer가 없다", () => {
  assert.deepEqual(Object.keys(shellApi), []);
  assert.equal("ipcRenderer" in shellApi, false);
});

test("shell/desktop#R16: lophn-shell handler는 설치 파일만 safe join으로 내주고 CSP를 붙인다", async () => {
  const root = await mkdtemp(join(tmpdir(), "shell-protocol-"));
  const outside = await mkdtemp(join(tmpdir(), "shell-outside-"));
  try {
    await mkdir(join(root, "desktop"));
    await writeFile(join(root, "desktop", "index.html"), "<p>ok</p>");
    await symlink(
      join(outside, "secret.txt"),
      join(root, "desktop", "leak.txt"),
    );
    await writeFile(join(outside, "secret.txt"), "secret");
    const handle = createShellHandler({ distDir: root });

    const ok = await handle(new Request("lophn-shell://desktop/index.html"));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers["content-security-policy"], SHELL_CSP);
    assert.equal(
      new TextDecoder().decode(ok.body ?? new Uint8Array()),
      "<p>ok</p>",
    );

    for (
      const path of ["../secret", "/%2e%2e/secret", "/desktop/%2e%2e%2fsecret"]
    ) {
      const res = await handle(new Request(`lophn-shell://desktop${path}`));
      assert.equal(res.status, 404, path);
    }
    const link = await handle(
      new Request("lophn-shell://desktop/desktop/leak.txt"),
    );
    assert.equal(link.status, 404);
    const other = await handle(
      new Request("https://evil.example/desktop/index.html"),
    );
    assert.equal(other.status, 404);
  } finally {
    await rm(root, { recursive: true });
    await rm(outside, { recursive: true });
  }
});

test("shell/desktop#R16: 인코딩된 경로 탐색은 safe join이 거절한다", () => {
  const root = "/opt/lophn/dist";
  assert.equal(
    safeJoin(root, "/desktop/index.html"),
    "/opt/lophn/dist/desktop/index.html",
  );
  assert.equal(safeJoin(root, "/desktop/%2e%2e/secret"), null);
  assert.equal(safeJoin(root, "/desktop/..%2fsecret"), null);
  assert.equal(safeJoin(root, "/%2e%2e/%2e%2e/etc/passwd"), null);
  assert.equal(safeJoin(root, "/desktop/%00"), null);
  assert.equal(safeJoin(root, "/desktop/%2e%2e%2f%2e%2e/secret"), null);
});

test("shell/app-frame#R23: handler 응답에 renderer가 읽을 secret이 없다", async () => {
  const root = await mkdtemp(join(tmpdir(), "shell-csp-"));
  try {
    await mkdir(join(root, "desktop"));
    await writeFile(join(root, "desktop", "index.html"), "hi");
    const res = await createShellHandler({ distDir: root })(
      new Request("lophn-shell://desktop/desktop/index.html"),
    );
    const served = await readFile(join(root, "desktop", "index.html"), "utf8");
    assert.equal(served, "hi");
    assert.equal(JSON.stringify(res.headers).includes("token"), false);
    assert.match(
      res.headers["content-security-policy"] ?? "",
      /default-src 'self'/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
