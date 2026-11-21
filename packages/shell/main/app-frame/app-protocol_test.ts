import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type AppProtocolDeps,
  createAppProtocolHandler,
  type FileReader,
  type ProtocolView,
  VIEW_HEADER,
} from "./app-protocol.ts";

const HASH = "a".repeat(64);
const LABEL = "app-01aaaaaaaaaaaaaaaaaaaaaaaaaa";

function setup(files: FileReader) {
  const view: ProtocolView = {
    view_session: "view-1",
    machine: null,
    appLabel: LABEL,
    screen: "home",
    target: {
      mode: "live",
      app: "app_01aaaaaaaaaaaaaaaaaaaaaaaaaa",
      release: null,
    },
    hosts: [],
  };
  const deps: AppProtocolDeps = {
    // 같은 앱의 view만 token으로 찾는다.
    viewFor: (token, label) =>
      token === "mine" && label === LABEL ? view : undefined,
    upstream: () => Promise.reject(new Error("screen bytes are not asked for")),
    files,
    stale: () => {},
  };
  const handler = createAppProtocolHandler(deps, LABEL);
  const get = (path: string, token = "mine", label = LABEL) =>
    handler(
      new Request(`lophn-app://${label}${path}`, {
        headers: { [VIEW_HEADER]: token },
      }),
    );
  return { view, get };
}

// 사람이 고른 file이 앱 화면처럼 돌면 안 된다: 적힌 type이 무엇이든 html·script·css·svg·xml로 나가지 않는다.
test("_files serves only the view's own app and never answers HTML, script, CSS, XML or SVG", async () => {
  const seen: unknown[] = [];
  let stored = "image/png";
  const { view, get } = setup(async (request) => {
    seen.push(request.target);
    return {
      ok: true,
      type: stored,
      size: 3,
      bytes: new Uint8Array([1, 2, 3]),
    };
  });

  const ok = await get(`/_files/${HASH}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.ok(ok.headers.get("content-security-policy"));
  assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [1, 2, 3]);
  // 어느 화면에서든 그 view의 대상으로 읽는다. 주소로 앱을 고르지 못한다.
  assert.deepEqual(seen, [view.target]);

  for (const type of [
    "text/html",
    "TEXT/HTML; charset=utf-8",
    "image/svg+xml",
    "application/javascript",
    "text/javascript",
    "text/css",
    "application/xml",
    "text/xml",
    "application/xhtml+xml",
  ]) {
    stored = type;
    const served = await get(`/_files/${HASH}`);
    assert.equal(
      served.headers.get("content-type"),
      "application/octet-stream",
      type,
    );
  }

  // 다른 앱의 view(token이 그 앱 것이 아니다)와 모르는 token, `_files` 밖의 모양은 404이고 core에 묻지 않는다.
  seen.length = 0;
  for (const response of [
    await get(`/_files/${HASH}`, "other"),
    await get(`/_files/${HASH}`, "mine", "app-01bbbbbbbbbbbbbbbbbbbbbbbbbb"),
    await get(`/_files/${"A".repeat(64)}`),
    await get(`/_files/${HASH}/x`),
    await get("/_files/index.html"),
    await get(`/other/${HASH}`),
  ]) {
    assert.equal(response.status, 404);
  }
  assert.deepEqual(seen, []);
});
