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

// 사람이 Settings › Agents에서 모든 project의 LOPHN.md 앞부분을 보는 읽기다. machine의 GetInstructions와
// 따로 두어 사람 자격으로 읽는다. 입력이 없다: 전역 층 하나뿐이라 run·층·경로를 받지 않는다. 파일이 없으면
// `preview`가 null이고 빈 파일은 본문이 빈 미리보기다. 읽는 파일은 같은 core 길이라 로컬 경로는 어느 칸에도 없다.
// 상한은 요구가 정하지 않아 추천값을 둔다: 화면 한 칸에 보이는 앞부분이라 4 KiB다(32 KiB 파일 상한의 1/8).
// 본문은 사람이 쓴 파일 그대로의 앞부분이다. 상한이 글자 가운데에 걸리면 그 글자 앞에서 끊고 `truncated`가 true다.
export const INSTRUCTION_PREVIEW_MAX_BYTES = 4096;

const instructionPreviewSchema = z.object({
  text: z.string().max(INSTRUCTION_PREVIEW_MAX_BYTES),
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  truncated: z.boolean(),
});
export type InstructionPreview = z.infer<typeof instructionPreviewSchema>;

export const instructionPreview = defineRead({
  resource: "instructions",
  method: "preview",
  name: "PreviewGlobalInstructions",
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({
      preview: instructionPreviewSchema.nullable(),
    }),
  ),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

// 지침은 4층이 이어 붙는다: 전역, project(LOPHN.md), domain(DOMAIN.md), agent. built-in role 지침은 prompt의
// 고정 본문이라 층이 아니고 app 층은 없다. 이어 붙이는 순서가 이 배열 순서다.
export const PROMPT_INSTRUCTION_LAYERS = [
  "global",
  "project",
  "domain",
  "agent",
] as const;

// `project`는 lophn이 `instructions.read`로 다른 project의 LOPHN.md를 읽을 때만 준다. 없으면 session의 place가
// 가리키는 project다. `domain`은 layer가 `domain`일 때 필수이고 아니면 거절이다. 출력과 상한은 위
// `instructionReadFileSchema`다.
const instructionsGetInputSchema = z.strictObject({
  session: idSchema("ses"),
  layer: z.enum(PROMPT_INSTRUCTION_LAYERS),
  project: idSchema("prj").optional(),
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

export const INSTRUCTION_ROUTES = [
  instructionsGet,
  instructionPreview,
] as const;
