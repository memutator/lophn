// Extensions 화면의 목록·설치·지우기는 main IPC(`lophnExtensions`)다. 켜기·끄기는 설정 쓰기라 SettingsSource가 한다.
import type { ExtensionsApi } from "../../../../ipc/extensions.ts";

export function windowExtensionsApi(): ExtensionsApi | undefined {
  const bridge = (globalThis as { lophnExtensions?: Partial<ExtensionsApi> })
    .lophnExtensions;
  return typeof bridge?.list === "function" &&
    typeof bridge.install === "function" &&
    typeof bridge.remove === "function"
    ? (bridge as ExtensionsApi)
    : undefined;
}
