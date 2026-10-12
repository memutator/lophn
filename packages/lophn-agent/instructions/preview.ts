import { err, ok, type Result } from "../../base/mod.ts";
import {
  INSTRUCTION_PREVIEW_MAX_BYTES,
  type InstructionPreview,
} from "../../protocol/lophn-agent/mod.ts";
import type { InstructionFile } from "./model.ts";

// 사람 화면의 LOPHN.md 미리보기(lophn-agent/instructions R9). 파일 앞 INSTRUCTION_PREVIEW_MAX_BYTES까지만 본문으로
// 주고 실제 크기와 잘림을 알린다. 상한이 글자 가운데에 걸리면 그 글자를 빼고 앞에서 끊는다: 반쪽 글자를 대체 문자로
// 바꿔 보이지 않는다. 파일이 UTF-8이 아니면 고쳐 보이지 않고 invalid_input이다(R7과 같은 규칙).
export function previewInstruction(
  file: InstructionFile,
): Result<InstructionPreview> {
  const cut = Math.min(file.bytes.length, INSTRUCTION_PREVIEW_MAX_BYTES);
  // 파일이 상한 뒤에도 이어지면 끝의 불완전한 글자는 잘림 때문이지 깨진 파일이 아니다.
  const continues = file.size_bytes > cut;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      file.bytes.subarray(0, cut),
      { stream: continues },
    );
    return ok({ text, size_bytes: file.size_bytes, truncated: continues });
  } catch {
    return err({
      code: "invalid_input",
      message: "instruction file is not UTF-8",
    });
  }
}
