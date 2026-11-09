// secret 값을 받는 보호 입력 창의 경계. shell main이 띄우는 작은 modal 창 하나다. 값은 보호
// 창과 main 메모리, 그리고 core로 가는 upload 본문에만 있고 일반 renderer와 agent 대화에는
// 가지 않는다. 이 파일은 main·preload·renderer가 함께 부르므로 zod 말고는 import하지 않는다.
import { z } from "zod";

/** 일반 창 → main: 보호 창을 연다. */
export const SECRET_INPUT_OPEN_CHANNEL = "shell:secret-input-open";
/** 보호 창 → main: 창에 그릴 것을 읽는다. */
export const SECRET_INPUT_DISPLAY_CHANNEL = "secret-input:display";
/** 보호 창 → main: 값을 보낸다. main이 core `secrets/put` upload로 넘기고 값 byte를 0으로 덮는다. */
export const SECRET_INPUT_SUBMIT_CHANNEL = "secret-input:submit";
/** 보호 창 → main: 그만둔다. */
export const SECRET_INPUT_CANCEL_CHANNEL = "secret-input:cancel";

/** protocol/secrets의 SECRET_INPUT_MAX_BYTES와 같은 값. */
export const SECRET_INPUT_MAX_BYTES = 64 * 1024;

// protocol/secrets의 secretNameSchema와 같은 규칙.
const secretName = z.string().regex(/^[A-Za-z0-9_.:-]+$/);
const purpose = z.enum(["app", "provider", "mcp", "login"]);

const secretInputNameOpenSchema = z
  .object({
    /** 저장할 secret 이름. */
    name: secretName,
    purpose,
    /** 창에 보일 대상 이름(앱, provider, MCP server)이나 login의 origin. 창은 글로만 그린다. */
    subject: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[^\p{Cc}]+$/u),
  })
  .strict();

/**
 * agent의 login 요청 card에서 연다. session과 tool call만 보내고 origin·mode·ref는 main이 core에서 읽는다
 * (card가 보인 origin은 shell main이 잰 값이고 renderer가 적은 글이 아니다).
 */
const secretInputRequestOpenSchema = z
  .object({
    request: z
      .object({
        session: z.string().min(1).max(64),
        tool_call: z.string().min(1).max(64),
      })
      .strict(),
  })
  .strict();

export const secretInputOpenSchema = z.union([
  secretInputNameOpenSchema,
  secretInputRequestOpenSchema,
]);
/** 이름으로 연다(설정·앱·provider·MCP). preload의 `openSecretInput`이 받는 입력이다. */
export type SecretInputNameOpen = z.infer<typeof secretInputNameOpenSchema>;
export type SecretInputRequestOpen = z.infer<
  typeof secretInputRequestOpenSchema
>;

const secretValue = z.string().refine((value) => {
  const size = new TextEncoder().encode(value).byteLength;
  return size >= 1 && size <= SECRET_INPUT_MAX_BYTES;
});

export const secretInputSubmitSchema = z.union([
  z.object({ value: secretValue }).strict(),
  // login 저장 요청 창의 여러 칸이다. totp는 비워 두면 보내지 않는다.
  z
    .object({
      login: z
        .object({
          label: z.string().min(1).max(100),
          username: z.string().max(200),
          password: secretValue,
          totp: secretValue.optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type SecretInputOpen = SecretInputNameOpen;
export type SecretInputSubmit = z.infer<typeof secretInputSubmitSchema>;
export type SecretInputPurpose = z.infer<typeof purpose>;

/** 값은 답에 없다. 호출한 화면은 `stored`를 받은 뒤에야 그 이름을 가리키는 command를 보낸다. */
export type SecretInputOpenReply =
  | { ok: true; result: "stored" | "cancelled" }
  // conflict: 이미 열린 보호 창이 있다.
  | {
      ok: false;
      code: "invalid_input" | "forbidden" | "conflict" | "unavailable";
    };

export type SecretInputDisplay = {
  name: string;
  purpose: SecretInputPurpose;
  subject: string;
  configured: boolean;
  /** agent의 login 요청이다. 있으면 `name`은 비고 `subject`가 shell main이 잰 origin이다. 창이 mode의 칸들을 그린다. */
  request?: { mode: "save" | "once"; label: string };
};

/** core 오류와 OS 오류 원문은 싣지 않는다. */
export type SecretInputSubmitReply =
  | { ok: true }
  | { ok: false; code: "invalid_input" | "unavailable" };

/** 일반 desktop 창이 보호 창을 여는 통로. */
export interface SecretInputOpenApi {
  open(input: SecretInputOpen): Promise<SecretInputOpenReply>;
}

/** 보호 창만 갖는 통로. */
export interface SecretInputApi {
  getDisplay(): Promise<SecretInputDisplay>;
  submit(input: SecretInputSubmit): Promise<SecretInputSubmitReply>;
  cancel(): Promise<Record<PropertyKey, never>>;
}
