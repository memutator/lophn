import type { Result } from "../../../base/mod.ts";
import type {
  ToolGateInput,
  ToolGateResult,
} from "../../../protocol/approvals/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  AskInput,
  AskResult,
} from "../../../protocol/lophn-agent/ask-tool.ts";

// tool이 기대는 port 가운데 contract에 없는 것이다. 구현은 wiring이 끼운다.

// ask가 기다림을 맡기는 port다. 질문 묶음을 대기 목록에 올리고, 사람이 답하거나 그 session에
// 메시지를 보내면 풀린다. 꺼졌다 켜지거나 turn이 끊기면 cancelled로 풀린다.
export interface QuestionWait {
  ask(
    call: { session: Id<"ses">; turn: Id<"trn">; tool_call: Id<"tcl"> },
    questions: AskInput["questions"],
  ): Promise<Result<AskResult>>;
}

// Gate가 걸리는 tool을 실행하기 직전에 core에 묻는다. turn이 아니면 실행하지 않는다.
export interface ToolGatePort {
  check(input: ToolGateInput): Promise<Result<ToolGateResult>>;
}

// 그 session의 role과 place가 file tool에 열어 둔 폴더다. 절대 경로이고 쓰기 폴더는 읽기 폴더 안에 있다.
export type PlaceScope = {
  read: readonly string[];
  write: readonly string[];
};

// skill 본문이나 딸린 파일을 읽는다. 도는 turn은 그 turn이 시작할 때 읽은 판을 쓴다. 꺼진 skill은 막는다.
export interface SkillReader {
  read(
    session: Id<"ses">,
    name: string,
    path?: string,
  ): Promise<Result<string>>;
}
