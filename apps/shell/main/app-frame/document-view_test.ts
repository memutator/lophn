import assert from "node:assert/strict";
import { test } from "node:test";
import { documentHostLabelFor } from "./document-protocol.ts";
import { openDocumentView } from "./document-view.ts";

const VERSION = "ver_01arz3ndektsv4rrffq69g5fav";
const LABEL = documentHostLabelFor(VERSION);

function fixture(viewSession = "view-1", versionFiles?: {
  files: { path: string; media_type: string; primary: boolean }[];
  read(path: string): Promise<Uint8Array | null>;
}) {
  const urls: string[] = [];
  let destroyed = false;
  let cleared = 0;
  let permissionRequests = 0;
  let permissionChecks = 0;
  let devicePermissions = 0;
  let blockedSet = false;
  const session = {
    setPermissionRequestHandler(
      handler: (
        contents: unknown,
        permission: string,
        callback: (allowed: boolean) => void,
      ) => void,
    ) {
      permissionRequests++;
      handler({}, "camera", (allowed) => assert.equal(allowed, false));
      handler({}, "geolocation", (allowed) => assert.equal(allowed, false));
    },
    setPermissionCheckHandler(handler: () => boolean) {
      permissionChecks++;
      assert.equal(handler(), false);
    },
    setDevicePermissionHandler(handler: () => boolean) {
      devicePermissions++;
      assert.equal(handler(), false);
    },
    clearStorageData: () => {
      cleared++;
      return Promise.resolve();
    },
  };
  const contents = {
    isDestroyed: () => destroyed,
    loadURL: (url: string) => {
      urls.push(url);
      return Promise.resolve();
    },
    close: () => {
      destroyed = true;
    },
  };
  const version = versionFiles ?? {
    files: [
      {
        path: "index.html",
        media_type: "text/html",
        primary: true,
      },
      { path: "style.css", media_type: "text/css", primary: false },
    ],
    read: (path: string) =>
      Promise.resolve(
        path === "index.html"
          ? new TextEncoder().encode("<p>x</p>")
          : path === "style.css"
          ? new TextEncoder().encode("p{}")
          : null,
      ),
  };
  const view = openDocumentView({
    versionId: VERSION,
    viewSession,
    contents,
    session,
    blockRequests: () => {
      blockedSet = true;
    },
    resolveVersion: () => Promise.resolve(version),
  });
  const handler = view.handle;
  const request = (method: string, url: string) => handler({ method, url });
  return {
    view,
    urls,
    request,
    session,
    contents,
    cleared: () => cleared,
    permissionRequests: () => permissionRequests,
    permissionChecks: () => permissionChecks,
    devicePermissions: () => devicePermissions,
    blocked: () => blockedSet,
    destroy: () => {
      destroyed = true;
    },
  };
}

test("shell/app-frame#R1, shell/app-frame#R11: 실행 가능한 문서는 소문자 version label view로 열고 registry가 고정 version으로 해석한다", async () => {
  const f = fixture();
  const url = await f.view.ready;
  assert.equal(url, `lophn-document://${LABEL}/index.html`);
  assert.equal(f.urls.at(-1), url);
  // view 주소의 host는 registry가 해석할 소문자 DNS label이다.
  assert.equal(new URL(url).hostname, LABEL);
  assert.equal(new URL(url).hostname, new URL(url).hostname.toLowerCase());
  // partition은 version과 view_session에 묶인다. 다른 session은 다른 partition.
  assert.equal(f.view.partition, `document-${VERSION}-view-1`);
});

test("shell/app-frame#R2, shell/app-frame#R17: 문서 CSP는 기본 resource·connection을 차단하고 자기 자원·data 이미지만 허용한다", async () => {
  const f = fixture();
  await f.view.ready;
  for (
    const url of [
      `lophn-document://${LABEL}/index.html`,
      `lophn-document://${LABEL}/style.css`,
    ]
  ) {
    const response = await f.request("GET", url);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers["content-security-policy"],
      "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'",
    );
    assert.equal(response.headers["x-content-type-options"], "nosniff");
  }
  // connect-src 'none'은 응답 header에 있으므로 외부 connection은 browser가 막는다.
  // 자원 경계는 요청을 좁혀 지킨다: 다른 문서 host·다른 scheme·userinfo·query는 404.
  for (
    const bad of [
      `lophn-document://ver_01arz3ndektsv4rrffq69g5fav/index.html`,
      `lophn-document://${LABEL}/missing.html`,
      `lophn-app://app-01arz3ndektsv4rrffq69g5fav/index.html`,
      `lophn-shell://desktop/index.html`,
      `https://example.com/x`,
      `lophn-document://${LABEL}/index.html?x=1`,
    ]
  ) {
    const response = await f.request("GET", bad);
    assert.equal(response.status, 404, bad);
    assert.equal(
      response.headers["content-security-policy"],
      "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'",
    );
  }
});

test("shell/app-frame#R2, shell/app-frame#R8: 문서 view session은 shell·다른 판과 저장 상태를 나누고 열기 요청은 차단된다", () => {
  const f = fixture();
  assert.equal(f.blocked(), true);
  const other = fixture("view-2");
  const first = f.view.partition;
  const second = other.view.partition;
  // 같은 key를 넣어도 다른 session에서 읽지 못하게 partition이 다르다.
  assert.match(first, new RegExp(`^document-${VERSION}-`));
  assert.match(second, new RegExp(`^document-${VERSION}-`));
  assert.notEqual(first, second);
});

test("shell/app-frame#R10, shell/app-frame#R14: 문서 view를 닫으면 webContents를 파괴하고 저장 상태를 지운다", async () => {
  const f = fixture();
  await f.view.ready;
  assert.equal(f.permissionRequests(), 1);
  assert.equal(f.permissionChecks(), 1);
  assert.equal(f.devicePermissions(), 1);
  await f.view.close();
  assert.equal(f.contents.isDestroyed(), true);
  assert.equal(f.cleared(), 1);
});

test("shell/app-frame#R14, shell/app-frame#R13: 문서 view의 노출은 protocol 좁히기·준비·partition·닫기뿐이고 원본 수정 통로가 없다", async () => {
  const f = fixture();
  await f.view.ready;
  // openDocumentView가 노출하는 것은 handle·ready·partition·close다. view가
  // 부를 수 있는 write·IPC 경로가 없으므로 script가 원본을 고치지 못한다.
  assert.deepEqual(Object.keys(f.view).sort(), [
    "close",
    "handle",
    "partition",
    "ready",
  ]);
  // handle의 응답은 읽기 메서드만 준다. write는 405다.
  const write = await f.request("PUT", `lophn-document://${LABEL}/index.html`);
  assert.equal(write.status, 405);
});

test("shell/app-frame#R13, shell/app-frame#R17: 문서 view의 worker·HEAD 요청도 같은 경계를 거친다", async () => {
  const f = fixture("view-1", {
    files: [
      { path: "index.html", media_type: "text/html", primary: true },
    ],
    read: (path: string) =>
      Promise.resolve(
        path === "index.html"
          ? new TextEncoder().encode(
            "<script type='module' src='./worker.js'></script>",
          )
          : null,
      ),
  });
  await f.view.ready;
  // worker script도 이 판의 자원만 내준다. 없는 path·다른 대상은 같은 404다.
  const head = await f.request("HEAD", `lophn-document://${LABEL}/index.html`);
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  const missing = await f.request("GET", `lophn-document://${LABEL}/worker.js`);
  assert.equal(missing.status, 404);
  const post = await f.request("POST", `lophn-document://${LABEL}/index.html`);
  assert.equal(post.status, 405);
});
