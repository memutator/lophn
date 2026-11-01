import type { Result } from "../../../base/mod.ts";
import type {
  InstructionFileName,
  PROMPT_INSTRUCTION_LAYERS,
} from "../../../protocol/lophn-agent/mod.ts";

// 사람 지침(LOPHN.md)의 층과 상한을 고르는 순수 규칙이다. LOPHN.md는 document·판을 쓰지 않는 그냥 파일이다.
// turn 시작에 읽는 쪽은 turn.ts, 파일을 여는 쪽은 core(files.ts)다.

export const INSTRUCTION_FILE_MAX_BYTES = 32768;

// 전역, project(LOPHN.md), domain(DOMAIN.md), agent 순서다.
export type InstructionLayerKind = (typeof PROMPT_INSTRUCTION_LAYERS)[number];
// 지침을 읽는 쪽이 보는 한 층의 파일. bytes는 처음부터 최대 INSTRUCTION_FILE_MAX_BYTES 만큼이다.
// 상한을 넘는 파일은 size_bytes로만 알면 되므로 끝까지 읽지 않는다.
export type InstructionFile = {
  // 전역·project 층이 실제로 연 파일(LOPHN.md 또는 CLAUDE.md).
  name?: InstructionFileName;
  size_bytes: number;
  bytes: Uint8Array;
};

// 읽기 통로는 읽기만 있다. 지침 파일 저장은 사람이 editor에서 파일을 저장하는 일이다. 어느 project의
// 파일인지는 통로가 이미 안다(그 session의 place).
export interface InstructionFiles {
  // 그 층의 지금 파일. 파일이 없으면 null(부재)이고 읽지 못하면 err다. `domain` 층은 domain id를 함께 준다.
  read(
    layer: InstructionLayerKind,
    domain?: string,
  ): Promise<Result<InstructionFile | null>>;
}

export type InstructionDeps = {
  files: InstructionFiles;
  // 전송 본문을 안전화한다. 끝내지 못하면 null이고 그 층은 전송하지 않는다(platform redaction).
  redact(text: string): string | null | Promise<string | null>;
};

type Inspected =
  | { status: "present"; text: string }
  | { status: "too_large" | "invalid"; reason: string };

// 상한을 넘으면 자르지 않고, UTF-8이 아니면 대체 문자로 바꾸지 않는다.
export function inspectInstruction(file: InstructionFile): Inspected {
  if (file.size_bytes > INSTRUCTION_FILE_MAX_BYTES) {
    return { status: "too_large", reason: "instruction file is too large" };
  }
  try {
    return {
      status: "present",
      text: new TextDecoder("utf-8", { fatal: true }).decode(file.bytes),
    };
  } catch {
    return { status: "invalid", reason: "instruction file is not UTF-8" };
  }
}
