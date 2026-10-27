// `$BROWSER`가 되는 shim 두 file. main이 per-run 폴더에 써 넣는다. sh에 박는 실행 file 경로
// (`process.execPath`)가 packaged와 dev에서 달라서 설치 묶음에 file로 싣지 않는다.
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
// 이 JS 본문은 policy.ts의 isRelayableUrl과 같은 검사를 따로 쓴다. main이 다시 검사하므로
// 여기는 쓸데없는 접속을 줄이는 용도다. URL이나 key는 stdout/stderr에 쓰지 않는다.
const SCRIPT = `"use strict";
const net = require("node:net");
const { spawn } = require("node:child_process");

const BRIDGE_ENV = ${JSON.stringify(BRIDGE_ENV)};
const KEY_PATTERN = new RegExp(${JSON.stringify(BRIDGE_KEY_PATTERN.source)});
const MAX_REQUEST_BYTES = ${MAX_REQUEST_BYTES};
const MAX_REPLY_BYTES = ${MAX_REPLY_BYTES};
const MAX_URL_CHARS = ${MAX_URL_CHARS};
const TIMEOUT_MS = ${SOCKET_TIMEOUT_MS};
const OPENER_FAILED = 4;

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
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  let child;
  try {
    child = spawn(command, [target], { detached: true, stdio: "ignore", env });
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

main();
`;

export function shimSources(
  paths: { shim: string; script: string },
  execPath: string,
): { sh: string; script: string } {
  const sh = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(execPath)} ${shellQuote(
    paths.script,
  )} "$@"\n`;
  return { sh, script: SCRIPT };
}

export function writeShim(
  deps: { write(path: string, text: string, mode: number): void },
  paths: { shim: string; script: string },
  execPath: string,
): void {
  const sources = shimSources(paths, execPath);
  deps.write(paths.script, sources.script, 0o600);
  deps.write(paths.shim, sources.sh, 0o700);
}
