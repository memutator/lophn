import {
  INPUT_TAGS,
  toWireToolName,
  UNTRUSTED_SOURCES,
  type UntrustedSource,
} from "../../../protocol/lophn-agent/mod.ts";
import { escapeBody } from "./input-text.ts";

// web 검색과 가져오기의 결과만 사람이 쓰지 않은 바깥 글이다. 파일·shell·app-api·외부 MCP 결과는 감싸지
// 않는다. 감싸는 글 안의 `<lophn-…` 는 모두 무력화해 결과가 닫는 tag를 흉내 내지 못하게 한다.

// tool 이름(정본 또는 wire 이름)이 바깥 글을 돌려주는 tool이면 그 출처다.
export function untrustedSource(tool: string): UntrustedSource | null {
  return UNTRUSTED_SOURCES.find((source) =>
    source === tool || toWireToolName(source) === tool
  ) ?? null;
}

export function wrapUntrusted(source: UntrustedSource, text: string): string {
  const tag = INPUT_TAGS.untrusted;
  return `<${tag} source="${source}">\n${escapeBody(text)}\n</${tag}>`;
}
