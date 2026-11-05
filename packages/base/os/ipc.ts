import type { OsPlatform } from "./home.ts";

// base는 node: import를 막는 이식 규칙이 있어 내장 module은 실행 때 process에서 얻는다. 동기 hash가 필요해서 crypto.subtle(hash.ts)을 못 쓴다.
function sha256Prefix(text: string): string {
  const { createHash } = process.getBuiltinModule("node:crypto");
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// POSIX는 socket file, Windows는 dir마다 달라지는 named pipe다(pipe 이름 공간은 하나라 data root를 hash로 가른다).
export function ipcPath(
  dir: string,
  name: string,
  platform: OsPlatform,
): string {
  if (platform === "win32") {
    return `\\\\.\\pipe\\lophn-${sha256Prefix(dir)}-${name}`;
  }
  return `${dir}/${name}.sock`;
}

// sun_path에서 NUL을 뺀 byte 수다(linux 108, macOS 104).
export function ipcPathLimit(platform: OsPlatform): number {
  if (platform === "win32") return 256;
  return platform === "darwin" ? 103 : 107;
}
