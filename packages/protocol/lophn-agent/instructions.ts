import { z } from "zod";
import { defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";

// LOPHN.md 자리. 경로 규칙은 documents가 갖고, 이 값은 그 등록 참조다.

// 지침 파일 한 층을 읽는 출력이다. 본문은 core가 파일에서 읽어 base64로 준다. 파일이 상한(32 KiB)을 넘으면 본문은
// 처음 32 KiB까지만 주고 `size_bytes`는 실제 크기다(읽는 쪽이 상한 초과로 call을 멈춘다). 파일이 없으면 `file`이
// null(부재)이고, 있는데 읽지 못하면 unavailable이다. 로컬 경로는 어느 칸에도 없다.
const INSTRUCTION_READ_MAX_BASE64 = 43_700;

const instructionReadFileSchema = z.object({
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  content_base64: z.string().max(INSTRUCTION_READ_MAX_BASE64),
});

export type InstructionReadFile = z.infer<typeof instructionReadFileSchema>;

// 지침은 4층이 이어 붙는다: 전역, project(LOPHN.md), domain(DOMAIN.md), agent. place 종류 지침은 prompt의
// 고정 본문이라 층이 아니고 app 층은 없다. 이어 붙이는 순서가 이 배열 순서다.
export const PROMPT_INSTRUCTION_LAYERS = [
  "global",
  "project",
  "domain",
  "agent",
] as const;

// 어느 project의 LOPHN.md인지는 session의 place로 정한다. `domain`은 layer가 `domain`일 때 필수이고 아니면 거절이다.
// 출력과 상한은 위 `instructionReadFileSchema`다.
const instructionsGetInputSchema = z.strictObject({
  session: idSchema("ses"),
  layer: z.enum(PROMPT_INSTRUCTION_LAYERS),
  domain: idSchema("dom").optional(),
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
