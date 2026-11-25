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
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";

import type { ToolContext } from "./tool-context.ts";

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

// file.write와 file.edit에 workspace 층이 끼우는 규칙이다. aroundWrite는 실제 쓰기(run)를 감싼다. 쓰기 기록을 어디에
// 남기는지는 harness가 모른다. agent.memory도 같은 aroundWrite를 쓴다.
export interface FileHooks {
  aroundWrite(
    ctx: ToolContext,
    target: { root: string; relative: string },
    run: () => Promise<Result<void>>,
  ): Promise<Result<void>>;
  // agent.memory가 쓸 파일(절대 경로)이다. 부른 session의 agent만 보고 정한다: lophn이면 자기 workspace의 workspace memory,
  // 사람이 만든 agent면 자기 agent memory다. 자리를 모르면 null이고, 없으면 agent.memory는 돌지 않는다.
  memoryFile?(agent: AgentId): string | null;
}

// 그 session의 workspace가 file tool에 열어 둔 폴더다. 절대 경로이고 쓰기 폴더는 읽기 폴더 안에 있다.
export type WorkspaceScope = {
  read: readonly string[];
  write: readonly string[];
  // 상대 경로를 푸는 기준 폴더. 허락 폴더는 아니다. 없으면 읽기 폴더의 첫째다.
  base?: string;
  // 이 session의 tool-results 폴더. 읽기에만 열리고 쓰기·base·cwd와는 무관하다. 폴더가 아직 없을 수 있다.
  results?: string;
  // Gate가 바깥 경로 한 번 호출을 run으로 허락했을 때 이 호출 한 번만 허용하는 대상.
  onceTarget?: { path: string; folder: string; mode: "read" | "write" };
  // 같은 turn의 남은 동안 이 폴더를 read와 write에 더한다. 이미 있으면 다시 넣지 않는다.
  open(folder: string): void;
};

// skill 본문이나 딸린 파일을 읽는다. 도는 turn은 그 turn이 시작할 때 읽은 판을 쓴다. 꺼진 skill은 막는다.
export interface SkillReader {
  read(
    session: Id<"ses">,
    name: string,
    path?: string,
  ): Promise<Result<string>>;
}
