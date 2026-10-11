import { z } from "zod";
import { defineRead, idSchema, withReadCommon } from "../platform/mod.ts";

export const INSTRUCTION_LAYERS = ["global", "project", "app"] as const;

// LOPHN.md 자리. 경로 규칙은 documents가 갖고, 이 값은 그 등록 참조다.
const locationFields = {
  layer: z.enum(INSTRUCTION_LAYERS),
  place: z.string().min(1),
};

export const instructionLocationSchema = z.strictObject(locationFields);
export const instructionLocationOutputSchema = z.object(locationFields);

export type InstructionLocation = z.infer<typeof instructionLocationSchema>;

// agent runtime이 model call 직전마다 읽는 사람 지침의 한 층이다(R4, R5, R8). machine만 읽는다.
// 어느 자리의 파일인지는 입력에 없다. core가 `run`의 작업 자리로 정한다: global은 `~/.lophn/LOPHN.md`,
// project는 그 project 폴더의 LOPHN.md, app은 그 앱 자리의 LOPHN.md, agent는 그 run의 agent 정의 본문이다.
// 작업 자리에 없는 층(project 자리 run의 app 층 등)은 없는 대상과 같은 not_found다. 본문은 core가 파일에서
// 읽어 base64로 준다. 파일이 상한(32 KiB)을 넘으면 본문은 처음 32 KiB까지만 주고 `size_bytes`는 실제
// 크기다(읽는 쪽이 상한 초과로 call을 멈춘다). 파일이 없으면 `file`이 null(부재)이고, 있는데 읽지 못하면
// unavailable이다. 로컬 경로는 어느 칸에도 없다.
export const INSTRUCTION_READ_MAX_BASE64 = 43_700;

export const INSTRUCTION_READ_LAYERS = [
  "global",
  "project",
  "app",
  "agent",
] as const;

export const instructionReadInputSchema = z.strictObject({
  run: idSchema("run"),
  layer: z.enum(INSTRUCTION_READ_LAYERS),
});

export const instructionReadFileSchema = z.object({
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  content_base64: z.string().max(INSTRUCTION_READ_MAX_BASE64),
});

export type InstructionReadFile = z.infer<typeof instructionReadFileSchema>;

export const instructionRead = defineRead({
  resource: "instructions",
  method: "read",
  name: "ReadInstructionFile",
  input: instructionReadInputSchema,
  output: withReadCommon(z.object({
    file: instructionReadFileSchema.nullable(),
  })),
  actors: ["machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const INSTRUCTION_ROUTES = [instructionRead] as const;

export const ASSIGNMENT_STATES = ["enabled", "paused", "withdrawn"] as const;
