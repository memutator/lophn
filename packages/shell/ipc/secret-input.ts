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

export const secretInputOpenSchema = z
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

export const secretInputSubmitSchema = z
  .object({
    value: z.string().refine((value) => {
      const size = new TextEncoder().encode(value).byteLength;
      return size >= 1 && size <= SECRET_INPUT_MAX_BYTES;
    }),
  })
  .strict();

export type SecretInputOpen = z.infer<typeof secretInputOpenSchema>;
type SecretInputSubmit = z.infer<typeof secretInputSubmitSchema>;
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
