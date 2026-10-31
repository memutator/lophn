import assert from "node:assert/strict";
import { test } from "node:test";

import { BROWSER_PARTITION } from "./session.ts";
import { hardenWebviewAttach, type WebviewTarget } from "./webview-guest.ts";

const BASE = { sandbox: true, contextIsolation: true, nodeIntegration: false };

const APP_SRC =
  "lophn-app://app-abc/panel/index.html?view_session=view-1&mount=1";
const APP_TARGET: WebviewTarget = {
  kind: "app",
  partition: "persist:app-app_abc:live",
  src: APP_SRC,
  preload: "/dist/preload-app.cjs",
};
const ARTIFACT_SRC = "lophn-artifact://artifact-1/index.html?mount=1";
const ARTIFACT_TARGET: WebviewTarget = {
  kind: "artifact",
  partition: "persist:lophn-artifact",
  src: ARTIFACT_SRC,
  preload: "/dist/preload-artifact.cjs",
};

const EVIL_PREFS = {
  preload: "file:///tmp/evil.js",
  nodeIntegration: true,
  sandbox: false,
};

function attach(
  params: Record<string, string>,
  overrides: {
    fromShell?: boolean;
    app?: WebviewTarget;
    artifact?: WebviewTarget;
    webPreferences?: Record<string, unknown>;
  } = {},
) {
  const webPreferences = { ...EVIL_PREFS };
  const target = hardenWebviewAttach({
    fromShell: overrides.fromShell ?? true,
    webPreferences,
    params,
    app: overrides.app,
    artifact: overrides.artifact,
    base: BASE,
  });
  return { target, webPreferences, params };
}

test("browser webview attach takes only our partition from the shell and hardens it", () => {
  assert.equal(
    attach(
      { partition: BROWSER_PARTITION, src: "https://a.example/" },
      {
        fromShell: false,
      },
    ).target,
    undefined,
  );
  assert.equal(attach({ partition: "persist:evil" }).target, undefined);
  assert.equal(attach({ src: "https://a.example/" }).target, undefined);

  const ok = attach({
    partition: BROWSER_PARTITION,
    src: "https://a.example/",
    preload: "file:///tmp/evil.js",
    webpreferences: "nodeIntegration=yes",
    disablewebsecurity: "on",
  });
  assert.equal(ok.target?.kind, "browser");
  assert.deepEqual(ok.webPreferences, {
    ...BASE,
    partition: BROWSER_PARTITION,
    disablePopups: false,
    devTools: true,
  });
  assert.equal(ok.params.preload, undefined);
  assert.equal(ok.params.webpreferences, undefined);
  assert.equal(ok.params.disablewebsecurity, undefined);
  assert.equal(ok.params.src, "https://a.example/");

  // shell·앱·artifact 문서 scheme은 browser guest로 열지 않는다.
  for (const src of [
    "lophn-app://x/index.html",
    "lophn-artifact://artifact-1/index.html",
  ]) {
    assert.equal(
      attach({ partition: BROWSER_PARTITION, src }).target,
      undefined,
      src,
    );
  }

  for (const src of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<p>x</p>",
  ]) {
    assert.equal(
      attach({ partition: BROWSER_PARTITION, src }).params.src,
      "about:blank",
      src,
    );
  }
});

test("app webview attach takes only the src its registry accepted and forces its partition", () => {
  // 다른 창의 view·모르는 src·이미 쓴 src는 registry의 acceptGuest가 undefined를 준다.
  const unknown = attach({ src: APP_SRC, partition: BROWSER_PARTITION });
  assert.equal(unknown.target, undefined);
  // 거절하면 prefs를 건드리지 않는다. 부르는 쪽이 그대로 preventDefault한다.
  assert.equal(unknown.webPreferences.nodeIntegration, true);

  const ok = attach(
    {
      src: APP_SRC,
      // app view는 partition 속성을 적지 않는다. 적어도 app partition으로 덮인다.
      partition: BROWSER_PARTITION,
      preload: "file:///tmp/evil.js",
      webpreferences: "nodeIntegration=yes",
      disablewebsecurity: "on",
      nodeintegration: "on",
      nodeintegrationinsubframes: "on",
      useragent: "evil",
      allowpopups: "on",
    },
    { app: APP_TARGET },
  );
  assert.equal(ok.target?.kind, "app");
  assert.equal(ok.target?.src, APP_SRC);
  assert.deepEqual(ok.webPreferences, {
    ...BASE,
    partition: APP_TARGET.partition,
    preload: APP_TARGET.preload,
    disablePopups: true,
  });
  assert.equal(ok.params.preload, undefined);
  assert.equal(ok.params.webpreferences, undefined);
  assert.equal(ok.params.disablewebsecurity, undefined);
  assert.equal(ok.params.nodeintegration, undefined);
  assert.equal(ok.params.nodeintegrationinsubframes, undefined);
  assert.equal(ok.params.useragent, undefined);
  assert.equal(ok.params.allowpopups, undefined);
  assert.equal(ok.params.partition, APP_TARGET.partition);
  assert.equal(ok.params.src, APP_SRC);
});

test("artifact webview attach uses the artifact partition and preload only", () => {
  assert.equal(attach({ src: ARTIFACT_SRC }).target, undefined);
  const ok = attach(
    { src: ARTIFACT_SRC, partition: "persist:evil", allowpopups: "on" },
    { artifact: ARTIFACT_TARGET },
  );
  assert.equal(ok.target?.kind, "artifact");
  assert.deepEqual(ok.webPreferences, {
    ...BASE,
    partition: ARTIFACT_TARGET.partition,
    preload: ARTIFACT_TARGET.preload,
    disablePopups: true,
  });
  assert.equal(ok.params.partition, ARTIFACT_TARGET.partition);
  assert.equal(ok.params.src, ARTIFACT_SRC);
});

test("a matching app src wins over a browser partition attribute", () => {
  const ok = attach(
    { src: APP_SRC, partition: BROWSER_PARTITION },
    { app: APP_TARGET },
  );
  assert.equal(ok.target?.kind, "app");
  assert.equal(
    (ok.webPreferences as Record<string, unknown>).partition,
    APP_TARGET.partition,
  );
});

test("a target whose src does not match the element is not attached as that kind", () => {
  assert.equal(
    attach(
      { src: "https://a.example/", partition: BROWSER_PARTITION },
      {
        app: APP_TARGET,
        artifact: ARTIFACT_TARGET,
      },
    ).target?.kind,
    "browser",
  );
  assert.equal(
    attach({ src: ARTIFACT_SRC }, { app: APP_TARGET }).target,
    undefined,
  );
});
