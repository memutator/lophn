import {
  toWireToolName,
  UNTRUSTED_SOURCES,
  type UntrustedSource,
} from "../../../protocol/lophn-agent/mod.ts";

// web 검색과 가져오기의 결과만 사람이 쓰지 않은 바깥 글이다. 파일·shell·app-api·외부 MCP 결과는 감싸지
// 않는다.

// tool 이름(정본 또는 wire 이름)이 바깥 글을 돌려주는 tool이면 그 출처다.
export function untrustedSource(tool: string): UntrustedSource | null {
  return UNTRUSTED_SOURCES.find((source) =>
    source === tool || toWireToolName(source) === tool
  ) ?? null;
}
