import type {
  AgentRole,
  CommandEntry,
  CommandNotice,
} from "../../contracts/lophn-agent/mod.ts";

// `/` 명령 registry(concern lophn-agent/commands). 저장하는 표가 아니라 열 때마다
// 코드의 built-in·role 목록과 그 agent가 쓸 수 있는 skill에서 계산하는 값이다(domain
// model 정책). IO가 없는 순수 함수다.

// extensions의 skill 발견 결과에서 registry가 쓰는 칸만이다. `origin`은 skill을 찾은
// 층(자리 층이면 place, 전역 층이면 workspace)이고, `selected`는 agent 정의에서
// 끄지 않았는지다.
export type RegistrySkill = {
  name: string;
  description: string;
  origin: "place" | "workspace";
  selected: boolean;
};

export type RegistryInput = {
  role: AgentRole;
  skills: readonly RegistrySkill[];
};

// entries는 전역 built-in(고정 순서) · role 명령 · skill(이름 사전순)의 순서다.
// notices는 built-in 이름과 같아 `/`에서 빠진 skill을 알린다.
export type CommandRegistry = {
  entries: readonly CommandEntry[];
  notices: readonly CommandNotice[];
};

// 모든 agent 공통 전역 built-in 여덟 개를 고정 순서로 준다(R2).
export function builtinCommands(): readonly CommandEntry[] {
  throw new Error("not implemented: agent-I6");
}

// 그 role의 built-in이다. lophn은 New app · Repair app, Context Engineer는 Check
// contracts · New context, App Engineer와 Operator는 빈 목록이다(R3).
export function roleCommands(_role: AgentRole): readonly CommandEntry[] {
  throw new Error("not implemented: agent-I6");
}

export function buildRegistry(_input: RegistryInput): CommandRegistry {
  throw new Error("not implemented: agent-I6");
}
