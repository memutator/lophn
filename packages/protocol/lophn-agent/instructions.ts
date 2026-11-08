import { z } from "zod";
import { defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";

// LOPHN.md 자리. 경로 규칙은 documents가 갖고, 이 값은 그 등록 참조다.

// 전역·Home·project 자리는 LOPHN.md를 먼저 열고, 없으면 같은 자리의 CLAUDE.md를 연다.
export const INSTRUCTION_FILE_NAMES = ["LOPHN.md", "CLAUDE.md"] as const;
// 앱 층은 앱 source의 AGENTS.md 하나다. 앱 template에서 오고 앱 agent가 이미 읽던 파일이라 앱에 한해 지침으로 읽는다.
export const APP_INSTRUCTION_FILE_NAME = "AGENTS.md";
export type InstructionFileName =
  | (typeof INSTRUCTION_FILE_NAMES)[number]
  | typeof APP_INSTRUCTION_FILE_NAME;

// 지침 파일 한 층을 읽는 출력이다. 본문은 core가 파일에서 읽어 base64로 준다. 파일이 상한(32 KiB)을 넘으면 본문은
// 처음 32 KiB까지만 주고 `size_bytes`는 실제 크기다(읽는 쪽이 상한 초과로 call을 멈춘다). 파일이 없으면 `file`이
// null(부재)이고, 있는데 읽지 못하면 unavailable이다. 로컬 경로는 어느 칸에도 없다.
const INSTRUCTION_READ_MAX_BASE64 = 43_700;

const instructionReadFileSchema = z.object({
  // 실제로 연 파일 이름. agent 층 밖에 있다(prompt 제목이 쓴다).
  name: z
    .enum([...INSTRUCTION_FILE_NAMES, APP_INSTRUCTION_FILE_NAME])
    .optional(),
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  content_base64: z.string().max(INSTRUCTION_READ_MAX_BASE64),
});

export type InstructionReadFile = z.infer<typeof instructionReadFileSchema>;

// 지침은 global → home | project | app → agent 순으로 이어 붙는다. session의 workspace가 home·project·앱 중 하나를
// 정하므로 그 셋 중 하나만 채워진다. workspace 종류 지침은 prompt의 고정 본문이라 층이 아니다. 층 목록은 이 배열 하나다
// (prompt 조립, 판 비교, 읽기가 모두 이것을 쓴다).
export const PROMPT_INSTRUCTION_LAYERS = [
  "global",
  "home",
  "project",
  "app",
  "agent",
] as const;

// 어느 workspace의 지침인지는 session의 workspace로 정한다.
// 출력과 상한은 위 `instructionReadFileSchema`다.
const instructionsGetInputSchema = z.strictObject({
  session: idSchema("ses"),
  layer: z.enum(PROMPT_INSTRUCTION_LAYERS),
});

export const instructionsGet = defineRead({
  resource: "instructions",
  method: "get",
  name: "GetInstructions",
  input: instructionsGetInputSchema,
  output: withReadCommon(
    z.object({
      file: instructionReadFileSchema.nullable(),
    }),
  ),
  actors: ["machine", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const INSTRUCTION_ROUTES = [instructionsGet] as const;
