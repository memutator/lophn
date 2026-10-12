// 해석 연결의 read 단계(problems/grouping#R13, R14; 질문 Q13). 고정 version이 있고 호출자가 읽을 수
// 있는지, 절이 그 version에 있는지는 derived라 command가 아니라 command 전에 읽어서 확인한다.
// documents의 `/v1/documents/get`·`history`와 `/v1/outline/document`(ver 지정)를 읽는 쪽이
// reader를 주입한다. 이 단계는 문서를 바꾸지 않고 문제 표도 읽지 않는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { InterpretationLink } from "../../../protocol/problems/mod.ts";

// outline의 section_status 중 연결을 허용하는 값은 found뿐이다. missing·unsupported·unverified는
// 연결할 절이 아니다.
export type SectionState =
  | "found"
  | "whole"
  | "missing"
  | "unsupported"
  | "unverified";

export type InterpretationReader = {
  // 호출자가 그 version을 읽을 수 있는가. 없는 version과 읽기 권한 밖은 같은 false다.
  readable(version: string): Promise<Result<boolean>>;
  // 그 version의 절 상태. 절 존재는 outline이 낸다.
  section(version: string, section: string): Promise<Result<SectionState>>;
};

export async function checkInterpretationLink(
  reader: InterpretationReader,
  link: InterpretationLink,
): Promise<Result<void>> {
  const readable = await reader.readable(link.version);
  if (!readable.ok) return readable;
  // 범위 밖은 없는 것과 같은 답이다.
  if (!readable.value) {
    return err({ code: "not_found", message: "해석 version을 찾을 수 없다" });
  }
  if (link.section === null) return ok(undefined);
  const state = await reader.section(link.version, link.section);
  if (!state.ok) return state;
  if (state.value !== "found") {
    return err({
      code: "invalid_input",
      message: `해석 절을 연결할 수 없다: ${state.value}`,
    });
  }
  return ok(undefined);
}
