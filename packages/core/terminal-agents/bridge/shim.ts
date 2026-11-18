// `$BROWSER`가 되는 shim과 그것이 돌리는 browser.js. shim에 박는 실행 file 경로(`process.execPath`)가
// packaged와 dev에서 달라서 설치 묶음에 file로 싣지 않는다. POSIX는 per-run 폴더의 sh, Windows는 data root
// `run\browser-<hash>\`에 build한 `browser.exe`이고 둘 다 같은 browser.js를 Electron의 Node로 돌린다.
//
// Windows가 `.cmd`가 아닌 이유: batch는 cmd.exe가 먼저 읽어 인자의 `& | % ^`를 명령으로 해석하고(URL이 잘리고 `&`
// 뒤가 실행됐다), file을 console 코드페이지로 읽어 한글 경로가 깨졌다. exe는 인자와 경로를 UTF-16 그대로 받는다.
import {
  BRIDGE_ENV,
  BRIDGE_KEY_PATTERN,
  MAX_REPLY_BYTES,
  MAX_REQUEST_BYTES,
  MAX_URL_CHARS,
  SOCKET_TIMEOUT_MS,
} from "./policy.ts";

function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

// 사용자 PATH에 node가 있다고 믿지 않으려고 Electron을 node로 띄운다(terminal host와 같은 방식).
// 이 JS 본문은 policy.ts의 isRelayableUrl과 같은 검사를 따로 쓴다. core가 다시 검사하므로
// 여기는 쓸데없는 접속을 줄이는 용도다. URL이나 key는 stdout/stderr에 쓰지 않는다.
// 이 본문은 개발 실행에서 `"type": "module"` package 아래 놓여도 돌아야 한다. `require`는 그때 없으므로
// async IIFE 안에서 동적으로 import한다(ESM의 top-level await는 CJS에서 못 쓴다). file 이름과 동작은 그대로다.
const SCRIPT = `"use strict";
(async () => {
const net = await import("node:net");
const { spawn } = await import("node:child_process");

const BRIDGE_ENV = ${JSON.stringify(BRIDGE_ENV)};
const KEY_PATTERN = new RegExp(${JSON.stringify(BRIDGE_KEY_PATTERN.source)});
const MAX_REQUEST_BYTES = ${MAX_REQUEST_BYTES};
const MAX_REPLY_BYTES = ${MAX_REPLY_BYTES};
const MAX_URL_CHARS = ${MAX_URL_CHARS};
const TIMEOUT_MS = ${SOCKET_TIMEOUT_MS};
const OPENER_FAILED = 4;
const CMD_META = /([()\\][%!^"\`<>&|;, *?])/g;

// cmd의 인용부호와 메타문자를 ^로 escape한다. 인용부호까지 escape해야 %expansion과 &...이
// 글자로 남는다(base/os/cmd-shim.ts의 META와 같은 규칙).
function cmdQuote(value) {
  return \`"\${value}"\`.replace(CMD_META, "^$1");
}

const target = process.argv[process.argv.length - 1];
if (process.argv.length < 3 || target === undefined || target === "") process.exit(0);

function bridgeConfig() {
  try {
    const parsed = JSON.parse(process.env[BRIDGE_ENV]);
    if (typeof parsed.socket !== "string" || parsed.socket === "") return null;
    if (typeof parsed.key !== "string" || !KEY_PATTERN.test(parsed.key)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function relayable(input) {
  if (input.length > MAX_URL_CHARS) return false;
  let url;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return url.username === "" && url.password === "";
}

// "pane"이면 true. 거절이든 실패든 false다.
function ask(config, url) {
  const request = JSON.stringify({ v: 1, key: config.key, url }) + "\\n";
  if (Buffer.byteLength(request) > MAX_REQUEST_BYTES) return Promise.resolve(false);
  return new Promise((resolve) => {
    let reply = "";
    let socket;
    const finish = (paned) => {
      clearTimeout(timer);
      if (socket !== undefined) socket.destroy();
      resolve(paned);
    };
    const timer = setTimeout(() => finish(false), TIMEOUT_MS);
    try {
      socket = net.createConnection(config.socket);
    } catch {
      finish(false);
      return;
    }
    socket.on("connect", () => socket.write(request));
    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
      if (Buffer.byteLength(reply) > MAX_REPLY_BYTES) return finish(false);
      const end = reply.indexOf("\\n");
      if (end === -1) return;
      try {
        finish(JSON.parse(reply.slice(0, end)).result === "pane");
      } catch {
        finish(false);
      }
    });
    socket.on("error", () => finish(false));
    socket.on("close", () => finish(false));
  });
}

function openWithSystem() {
  // BROWSER를 남기면 xdg-open이 이 shim을 다시 부르고, ELECTRON_RUN_AS_NODE를 남기면
  // opener가 Electron 앱일 때 node처럼 뜬다.
  const env = { ...process.env };
  delete env.BROWSER;
  delete env[BRIDGE_ENV];
  delete env.ELECTRON_RUN_AS_NODE;
  const platform = process.platform;
  const command = platform === "darwin"
    ? "open"
    : platform === "win32"
      ? process.env.ComSpec || "cmd.exe"
      : "xdg-open";
  // Windows는 cmd.exe의 start를 쓴다. 첫 인자를 창 제목으로 읽으므로 빈 title을 따로 주고, cmd가
  // 인용부호 밖의 & | < > ^ 를 명령으로 읽고 %를 변수로 풀기 때문에 URL 전체를 cross-spawn처럼 ^로
  // escape한다(base/os/cmd-shim.ts와 같은 규칙). /v:off는 !를 늦은 확장에서 뗀다.
  const args = platform === "win32"
    ? ["/d", "/s", "/v:off", "/c", \`"start "" \${cmdQuote(target)}"\`]
    : [target];
  let child;
  try {
    child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      env,
      ...(platform === "win32" ? { windowsVerbatimArguments: true } : {}),
    });
  } catch {
    process.exit(OPENER_FAILED);
  }
  // 3초 안에 안 끝나면 GUI opener가 남아 있는 것이다.
  const timer = setTimeout(() => process.exit(0), TIMEOUT_MS);
  child.on("error", () => process.exit(OPENER_FAILED));
  child.on("exit", (code) => {
    clearTimeout(timer);
    process.exit(code === 0 ? 0 : OPENER_FAILED);
  });
}

async function main() {
  const config = bridgeConfig();
  if (config !== null && relayable(target) && await ask(config, target)) process.exit(0);
  openWithSystem();
}

await main();
})();
`;

/** POSIX sh shim을 per-run 폴더에 쓴다. */
export function writeShim(
  deps: { write(path: string, text: string, mode: number): void },
  paths: { shim: string; script: string },
  execPath: string,
): void {
  deps.write(paths.script, SCRIPT, 0o600);
  deps.write(
    paths.shim,
    `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(execPath)} ${shellQuote(
      paths.script,
    )} "$@"\n`,
    0o700,
  );
}

// Windows launcher의 C# 본문. 옆의 browser.js를 `execPath`(Electron)로 Node처럼 돌리고 받은 인자를 그대로 넘긴다.
// 인자는 CommandLineToArgvW 규칙으로 다시 묶는다(cmd.exe를 거치지 않아 `& | % ^ !`는 글자다). 종료 상태를 돌려준다.
function launcherSource(execPath: string): string {
  return `using System;
using System.Diagnostics;
using System.IO;
using System.Text;

static class LophnBrowser {
  static string Quote(string arg) {
    if (arg.Length > 0 && arg.IndexOfAny(new char[] { ' ', '\\t', '\\n', '\\v', '"' }) < 0) return arg;
    StringBuilder sb = new StringBuilder("\\"");
    int slashes = 0;
    foreach (char c in arg) {
      if (c == '\\\\') { slashes++; continue; }
      if (c == '"') { sb.Append('\\\\', slashes * 2 + 1); } else { sb.Append('\\\\', slashes); }
      sb.Append(c);
      slashes = 0;
    }
    sb.Append('\\\\', slashes * 2);
    sb.Append('"');
    return sb.ToString();
  }

  static int Main(string[] args) {
    string script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "browser.js");
    StringBuilder line = new StringBuilder(Quote(script));
    foreach (string arg in args) { line.Append(' '); line.Append(Quote(arg)); }
    ProcessStartInfo info = new ProcessStartInfo(@"${execPath.replaceAll('"', '""')}", line.ToString());
    info.UseShellExecute = false;
    info.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
    using (Process child = Process.Start(info)) {
      child.WaitForExit();
      return child.ExitCode;
    }
  }
}
`;
}

/**
 * Windows launcher의 file들. `dir`은 내용이 바뀌면 다른 폴더가 되도록 `hash`(sha256 hex)로 이름 짓는다.
 * 같은 판·같은 Electron이면 앞서 build한 exe를 다시 쓴다.
 */
export function winLauncherFiles(
  execPath: string,
  hash: (text: string) => string,
): { name: string; script: string; source: string } {
  const source = launcherSource(execPath);
  return {
    name: `browser-${hash(SCRIPT + source).slice(0, 12)}`,
    script: SCRIPT,
    // csc는 BOM이 없으면 source를 ANSI 코드페이지로 읽어 한글 경로가 깨진다.
    source: `﻿${source}`,
  };
}
