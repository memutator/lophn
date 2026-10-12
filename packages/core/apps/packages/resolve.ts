import { parseLophnSdkSpecifier } from "./model.ts";

// `lophn-sdk:<name>@<version>` specifier의 해석.
// 정확한 version만 받는다. ^·~·latest와 암묵적 최신 선택은 거절이다.
// bundle 내부 경로는 release 준비(import-map.ts)가 잠그므로 여기서는
// specifier의 이름·version만 판정한다.
export function resolveLophnSdk(
  specifier: string,
): { name: string; version: string } | undefined {
  return parseLophnSdkSpecifier(specifier);
}
