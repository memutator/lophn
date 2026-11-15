import { codingBuiltinOf } from "../../../../protocol/lophn-agent/workspaces.ts";
import {
  harnessVendorOf,
  type Vendor,
} from "../../parts/vendor-icon/vendors.ts";

/**
 * 내장 coding agent의 얼굴은 사람이 쓰는 그 제품의 아이콘이다. lophn agent처럼 꾸미지 않는다.
 * 내장 coding agent가 아니면 undefined. 아이콘 그림 대신 이름 표만 읽어 폰의 data 층도 이 파일을 쓴다.
 */
export function codingFaceOf(
  agent: string,
): { readonly kind: "vendor"; readonly vendor: Vendor } | undefined {
  const coding = codingBuiltinOf(agent);
  const vendor = coding === null ? undefined : harnessVendorOf(coding.harness);
  return vendor === undefined ? undefined : { kind: "vendor", vendor };
}
