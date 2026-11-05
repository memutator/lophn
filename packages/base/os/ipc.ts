import type { OsPlatform } from "./home.ts";

// base는 node: import를 막는 이식 규칙이 있고 crypto.subtle(hash.ts)은 비동기라, 동기 FNV-1a 64bit를 쓴다. dir마다 안정적이기만 하면 되고 보안 용도가 아니다.
function dirHash(text: string): string {
  const mask = (1n << 64n) - 1n;
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

// POSIX는 socket file, Windows는 dir마다 달라지는 named pipe다(pipe 이름 공간은 하나라 data root를 hash로 가른다).
export function ipcPath(
  dir: string,
  name: string,
  platform: OsPlatform,
): string {
  if (platform === "win32") {
    return `\\\\.\\pipe\\lophn-${dirHash(dir)}-${name}`;
  }
  return `${dir}/${name}.sock`;
}

// sun_path에서 NUL을 뺀 byte 수다(linux 108, macOS 104).
export function ipcPathLimit(platform: OsPlatform): number {
  if (platform === "win32") return 256;
  return platform === "darwin" ? 103 : 107;
}
