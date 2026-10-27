// 앱과 flow가 wave 3까지 Deno로 뜰 때 core가 쓰는 Deno binary를 푼다.
// packaged는 설치 root(`/opt/lophn/deno`), 개발은 PATH의 `deno`다.

import { packagedInstall } from "../paths.ts";

interface BinaryResolutionPort {
  isPackaged: boolean;
  resourcesPath?: string;
}

/**
 * packaged 실행에서는 설치 root의 deno, 개발에서는 "deno"를 돌려준다.
 * Deno binary가 없으면 개발과 같은 "deno"를 시도한다.
 */
export function resolveAppDenoBinary(
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
  log?.(`resolved bundled deno for apps and flows: ${bundledBinary}`);
  return bundledBinary;
}
