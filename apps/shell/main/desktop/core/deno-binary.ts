// Resolve bundled Deno binary for packaged app (shell#T57, shell/desktop#R20).
// When packaged, the Deno binary is at the install root (`/opt/lophn/deno`, platform#T48).
// In development, use the system deno command.

import { packagedInstall } from "../paths.ts";

export interface BinaryResolutionPort {
  isPackaged: boolean;
  resourcesPath?: string;
}

/**
 * packaged 실행에서는 설치 root의 deno, 개발에서는 "deno"를 돌려준다.
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

  // 설치 root(`/opt/lophn/`)의 `deno`다. resources/는 그 바로 아래에 있다.
  const bundledBinary = packagedInstall(port.resourcesPath).deno;
  log?.(`resolved bundled deno: ${bundledBinary}`);
  return bundledBinary;
}
