import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Navigation,
  overlaySecurityFactory,
  overlayTarget,
  type Preventable,
} from "./overlay-security.ts";

test("shell/app-frame#R24: overlay factory installs one shared deny session and exact navigation contents policies", () => {
  const factory = overlaySecurityFactory();
  let installs = 0;
  let download: (event: Preventable) => void = () => {};
  let releases = 0;
  const session = {
    denyPermissions() {
      installs++;
    },
    onDownload(fn: typeof download) {
      download = fn;
      return () => {
        releases++;
      };
    },
  };
  factory.session(session);
  factory.session(session);
  assert.equal(installs, 1);
  let navigation: (event: Navigation) => void = () => {};
  let webview = download;
  let devtools = () => {};
  let closed = 0;
  const release = factory.contents({
    setWindowOpenHandler(fn) {
      assert.equal(fn().action, "deny");
    },
    onNavigation(fn) {
      navigation = fn;
      return () => {
        releases++;
      };
    },
    onWebview(fn) {
      webview = fn;
      return () => {
        releases++;
      };
    },
    onDevtools(fn) {
      devtools = fn;
      return () => {
        releases++;
      };
    },
    closeDevTools() {
      closed++;
    },
  }, true);
  for (
    const url of [
      "lophn-shell://overlay/index.html",
      "lophn-shell://overlay/index.html#surface",
    ]
  ) assert(overlayTarget(url));
  for (
    const url of [
      "lophn-shell://desktop/index.html",
      "https://overlay/index.html",
      "file:///index.html",
      "lophn-shell://overlay/other.html",
      "lophn-shell://user:password@overlay/index.html",
      "lophn-shell://overlay/index.html?url=other",
    ]
  ) {
    assert.equal(overlayTarget(url), false);
    let denied = false;
    navigation({
      url,
      isMainFrame: true,
      preventDefault() {
        denied = true;
      },
    });
    assert(denied);
  }
  let denied = 0;
  const event = {
    preventDefault() {
      denied++;
    },
  };
  navigation({
    ...event,
    url: "lophn-shell://overlay/index.html",
    isMainFrame: false,
  });
  webview(event);
  download(event);
  assert.equal(denied, 3);
  devtools();
  assert.equal(closed, 1);
  release();
  factory.dispose();
  assert.equal(releases, 4);
});
