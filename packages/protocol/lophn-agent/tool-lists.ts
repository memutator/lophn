import type { PlaceKind } from "./places.ts";

// place 종류가 보는 내장 tool의 이름 목록이다. 정의는 각 tool file이 갖는다. 편집 화면의 bare tool 고르기도 같은 목록을 쓴다.

export const COMMON_TOOLS = [
  "file.read",
  "file.glob",
  "file.grep",
  "file.outline",
  "pdf.read",
  "image.read",
  "web.search",
  "web.fetch",
  "lophn",
  "ask",
  "skill.read",
] as const;

// 작업 tool은 home이 빼고 project·app이 갖는다.
export const WORK_TOOLS = ["file.write", "file.edit", "shell.run"] as const;

// 읽기 tool은 세 place 종류가 모두 갖는다.
export const READ_TOOLS = ["visual.show"] as const;

// place 종류가 더하는 tool이다.
const PLACE_TOOLS = {
  home: [],
  project: [...WORK_TOOLS],
  app: [...WORK_TOOLS],
} as const satisfies Record<PlaceKind, readonly string[]>;

// place 종류 고정 목록 = 공통 + 읽기 + place 종류 몫. 명령(`lophn` tool로 부르는 job 등)은 여기 없고
// 명령 표의 place 종류 칸이 정한다.
// image.read를 vision 없는 model에서 빼는 일은 이 목록이 아니라 core registry가 한다.
export function placeToolNames(kind: PlaceKind): readonly string[] {
  return [...COMMON_TOOLS, ...READ_TOOLS, ...PLACE_TOOLS[kind]];
}
