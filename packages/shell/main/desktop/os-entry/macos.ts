// macOS 앱 바로가기. `~/Applications`의 작은 app bundle이고 실행 파일은 검증된 lophn 실행
// 경로를 `--open-app <app ID>`로 exec하는 두 줄 script뿐이다. bundle은
// Dock에 따로 머물지 않는다(LSUIElement). 실제 창은 이미 떠 있는 lophn main이 연다.
import { join } from "node:path";

import { OPEN_APP_FLAG } from "../open-intent.ts";
import type { OsEntryApp } from "./entry.ts";

const MAC_LAUNCHER = "open-app";

interface BundleFile {
  /** bundle 안 상대 경로. */
  path: string;
  data: string;
  mode: number;
}

export function macBundlePath(home: string, app: string): string {
  return join(home, "Applications", `lophn-${app}.app`);
}

function xml(text: string): string {
  return text
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function macBundleFiles(
  execPath: string,
  app: OsEntryApp,
): BundleFile[] {
  const name = xml(app.name);
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>CFBundleExecutable</key>",
    `  <string>${MAC_LAUNCHER}</string>`,
    "  <key>CFBundleIdentifier</key>",
    `  <string>lophn.open-app.${app.id.replaceAll("_", "-")}</string>`,
    "  <key>CFBundleName</key>",
    `  <string>${name}</string>`,
    "  <key>CFBundleDisplayName</key>",
    `  <string>${name}</string>`,
    "  <key>CFBundlePackageType</key>",
    "  <string>APPL</string>",
    "  <key>LSUIElement</key>",
    "  <true/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
  const script = [
    "#!/bin/sh",
    `exec "${execPath}" ${OPEN_APP_FLAG} ${app.id}`,
    "",
  ].join("\n");
  return [
    { path: join("Contents", "Info.plist"), data: plist, mode: 0o644 },
    {
      path: join("Contents", "MacOS", MAC_LAUNCHER),
      data: script,
      mode: 0o755,
    },
  ];
}
