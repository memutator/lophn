import { z } from "zod";
import { ERROR_CODES } from "../../base/mod.ts";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { loginIdSchema, loginOriginSchema } from "../secrets/logins.ts";
import { secretNameSchema } from "../secrets/secrets.ts";
import { browserRefSchema } from "./host-queue.ts";

// agent가 사람에게 값을 넣어 달라고 청하는 요청 하나다. 종류는 둘이다.
// - login: 탭의 입력 칸(ref)을 가리켜 site login 저장(save)이나 값 한 번 넣기(once)를 청한다.
// - secret: secret이 들어가는 자리(provider key, 앱이 선언한 secret)를 가리켜 값을 청한다.
// 요청은 `ask`와 같은 대기열에 서서 대화에 card로 뜨고, 사람이 card를 눌러야 shell main이 보호 입력 창을 연다.
// agent는 창을 열 수 없고 값을 보지 못한다. card에 보이는 "값이 가는 곳"(origin, 목적지)은 agent가 적은 글이 아니라
// shell main이 재거나 core가 정의·선언에서 읽은 값이다.

export const LOGIN_REQUEST_MODES = ["save", "once"] as const;
export const loginRequestModeSchema = z.enum(LOGIN_REQUEST_MODES);
export type LoginRequestMode = z.infer<typeof loginRequestModeSchema>;

const label = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[^\p{Cc}]+$/u);

// agent는 secret 이름을 정하지 못하고 자리만 가리킨다. 이름을 받으면 다른 자리의 값을 덮어쓰게 하거나 값을 자기가 고른
// 목적지로 나가는 이름에 넣게 할 수 있다. provider는 내장 정의의 key, 앱 secret은 그 앱이 `secret.use`로 선언한 이름이다.
export const secretSlotSchema = z.union([
  z.strictObject({ provider: z.string().min(1).max(64) }),
  z.strictObject({ app: idSchema("app"), secret: secretNameSchema }),
]);
export type SecretSlot = z.infer<typeof secretSlotSchema>;

const target = { session: idSchema("ses"), tool_call: idSchema("tcl") };

// login save는 login id, once는 filled, secret은 stored다. 값은 어디에도 없다.
export const inputRequestResultSchema = z.union([
  z.strictObject({ login: loginIdSchema }),
  z.strictObject({ filled: z.literal(true) }),
  z.strictObject({ stored: z.literal(true) }),
  z.strictObject({ cancelled: z.literal(true) }),
  z.strictObject({ unattended: z.literal(true) }),
]);
export type InputRequestResult = z.infer<typeof inputRequestResultSchema>;

const loginViewSchema = z.strictObject({
  kind: z.literal("login"),
  group: idSchema("qgr"),
  tab: idSchema("tab"),
  view: z.enum(["browser", "preview", "artifact"]),
  ref: browserRefSchema,
  mode: loginRequestModeSchema,
  label,
  origin: loginOriginSchema,
  // 요청 때 탭 page의 제목이다. page가 정한 글이라 origin과 달리 믿지 않는다. card가 작게 보인다.
  title: z.string().max(200),
});

const secretViewSchema = z.strictObject({
  kind: z.literal("secret"),
  group: idSchema("qgr"),
  slot: secretSlotSchema,
  // core가 자리에서 만든 secret 이름이다(`provider.<id>`, 앱이 선언한 이름).
  name: secretNameSchema,
  // 사람이 읽는 대상 이름(provider 이름, 앱 이름).
  subject: label,
  // 이 값이 실려 나가는 곳이다. provider는 endpoint, 앱은 선언한 `net.fetch` 목적지다. 없으면 빈 목록이다.
  destinations: z.array(z.string().min(1).max(300)).max(32),
  // 이미 값이 있는 자리다. 넣으면 바꾼다.
  configured: z.boolean(),
  // 값을 저장한 뒤 shell main이 보낼 ConnectProvider 입력(credential 빼고)이다. 새로 연결하는 provider 자리에만 있다.
  connect: z.record(z.string(), z.unknown()).nullable(),
});

// 열린 요청이 card와 보호 창에 보이는 내용이다.
export const inputRequestViewSchema = z.discriminatedUnion("kind", [
  loginViewSchema,
  secretViewSchema,
]);
export type InputRequestView = z.infer<typeof inputRequestViewSchema>;
export type LoginRequestView = z.infer<typeof loginViewSchema>;
export type SecretRequestView = z.infer<typeof secretViewSchema>;

// agent 쪽 입구다. 사람이 풀 때까지 기다린다. 사람이 없는 turn이면 unattended를 바로 돌려준다.
// login: 내 탭이 아니면 not_found, ref의 frame origin을 shell이 잴 수 없으면 forbidden, 낡은 ref는 conflict, shell이 없으면 unavailable.
// secret: 없는 자리(모르는 정의, 앱이 선언하지 않은 이름)는 not_found, 그 workspace의 agent가 청할 수 없는 자리는 forbidden.
export const inputRequestAsk = defineMemory({
  resource: "input_request",
  method: "ask",
  name: "InputRequestAsk",
  input: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("login"),
      tab: idSchema("tab"),
      ref: browserRefSchema,
      mode: loginRequestModeSchema,
      label: label.optional(),
    }),
    z.strictObject({ kind: z.literal("secret"), slot: secretSlotSchema }),
  ]),
  output: inputRequestResultSchema,
  actors: ["agent"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

export const inputRequestRead = defineMemory({
  resource: "input_request",
  method: "read",
  name: "InputRequestRead",
  input: z.strictObject(target),
  output: inputRequestViewSchema,
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found"],
});

// card의 Cancel이다.
export const inputRequestCancel = defineMemory({
  resource: "input_request",
  method: "cancel",
  name: "InputRequestCancel",
  input: z.strictObject(target),
  output: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found"],
});

// shell main만 부른다(renderer 통로에 없다). login once 값을 그 session이 끝날 때까지 알려진 값으로 등록한다. 값은 저장하지 않는다.
export const inputRequestHold = defineMemory({
  resource: "input_request",
  method: "hold",
  name: "InputRequestHold",
  input: z.strictObject({ ...target, value: z.string().min(1).max(1000) }),
  output: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// shell main만 부른다. 요청을 끝내고 기다리던 agent에게 결과를 준다.
export const inputRequestDone = defineMemory({
  resource: "input_request",
  method: "done",
  name: "InputRequestDone",
  input: z.strictObject({
    ...target,
    result: z.union([
      z.strictObject({ login: loginIdSchema }),
      z.strictObject({ filled: z.literal(true) }),
      z.strictObject({ stored: z.literal(true) }),
      z.strictObject({
        error: z.strictObject({
          code: z.enum(ERROR_CODES),
          message: z.string().max(500),
        }),
      }),
    ]),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found"],
});

export const INPUT_REQUEST_ROUTES = [
  inputRequestAsk,
  inputRequestRead,
  inputRequestCancel,
  inputRequestHold,
  inputRequestDone,
] as const;
