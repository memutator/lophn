// Resolve bundled Deno binary for packaged app (shell#T57, shell/desktop#R20).
// When packaged, the Deno binary is staged at resources/bin/deno (or deno.exe on Windows).
// In development, use the system deno command.

import * as path from "node:path";

export interface BinaryResolutionPort {
  isPackaged: boolean;
  resourcesPath?: string;
}

/**
 * packaged 실행에서는 resources/bin/deno, 개발에서는 "deno"를 돌려준다.
 * Deno binary가 없으면 개발과 같은 "deno"를 시도한다.
 */
export function resolveDenoBinary(
  port: BinaryResolutionPort,
  log?: (msg: string) => void,
): string {
  if (!port.isPackaged) {
    return "deno"; // Development: use system deno
  }

  if (!port.resourcesPath) {
    log?.(
      "warning: packaged app but no resourcesPath; falling back to system deno",
    );
    return "deno";
  }

  const exe = process.platform === "win32" ? "deno.exe" : "deno";
  const bundledBinary = path.join(port.resourcesPath, "bin", exe);
  log?.(`resolved bundled deno: ${bundledBinary}`);
  return bundledBinary;
}
