import { z } from "zod";
import { ERROR_CODES } from "../../base/mod.ts";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { loginIdSchema, loginOriginSchema } from "../secrets/logins.ts";
import { browserRefSchema } from "./host-queue.ts";

// agent가 탭의 입력 칸(ref)을 가리켜 사람에게 login 저장(save)이나 값 한 번 넣기(once)를 요청한다. 요청은 `ask`와 같은 대기열에
// 서서 대화에 card로 뜨고, 사람이 card를 눌러야 shell main이 보호 입력 창을 연다. agent는 창을 열 수 없고 값을 보지 못한다.
// card의 origin은 shell main이 ref의 frame에서 잰 값이다(agent 입력이 아니다).

export const LOGIN_REQUEST_MODES = ["save", "once"] as const;
export const loginRequestModeSchema = z.enum(LOGIN_REQUEST_MODES);
export type LoginRequestMode = z.infer<typeof loginRequestModeSchema>;

const label = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[^\p{Cc}]+$/u);

const target = { session: idSchema("ses"), tool_call: idSchema("tcl") };

// save는 login id, once는 filled다. 값은 어디에도 없다.
export const loginRequestResultSchema = z.union([
  z.strictObject({ login: loginIdSchema }),
  z.strictObject({ filled: z.literal(true) }),
  z.strictObject({ cancelled: z.literal(true) }),
  z.strictObject({ unattended: z.literal(true) }),
]);
export type LoginRequestResult = z.infer<typeof loginRequestResultSchema>;

// 열린 요청이 card와 보호 창에 보이는 내용이다.
export const loginRequestViewSchema = z.strictObject({
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
export type LoginRequestView = z.infer<typeof loginRequestViewSchema>;

// agent 쪽 입구다. 사람이 풀 때까지 기다린다. 내 탭이 아니면 not_found, 사람이 없는 turn이면 unattended를 바로 돌려준다.
// ref의 frame origin을 shell이 잴 수 없으면 forbidden, 낡은 ref는 conflict, shell이 없으면 unavailable이다.
export const loginRequestAsk = defineMemory({
  resource: "login_request",
  method: "ask",
  name: "LoginRequestAsk",
  input: z.strictObject({
    tab: idSchema("tab"),
    ref: browserRefSchema,
    mode: loginRequestModeSchema,
    label: label.optional(),
  }),
  output: loginRequestResultSchema,
  actors: ["agent"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

export const loginRequestRead = defineMemory({
  resource: "login_request",
  method: "read",
  name: "LoginRequestRead",
  input: z.strictObject(target),
  output: loginRequestViewSchema,
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found"],
});

// card의 Cancel이다.
export const loginRequestCancel = defineMemory({
  resource: "login_request",
  method: "cancel",
  name: "LoginRequestCancel",
  input: z.strictObject(target),
  output: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found"],
});

// shell main만 부른다(renderer 통로에 없다). once 값을 그 session이 끝날 때까지 알려진 값으로 등록한다. 값은 저장하지 않는다.
export const loginRequestHold = defineMemory({
  resource: "login_request",
  method: "hold",
  name: "LoginRequestHold",
  input: z.strictObject({ ...target, value: z.string().min(1).max(1000) }),
  output: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// shell main만 부른다. 요청을 끝내고 기다리던 agent에게 결과를 준다.
export const loginRequestDone = defineMemory({
  resource: "login_request",
  method: "done",
  name: "LoginRequestDone",
  input: z.strictObject({
    ...target,
    result: z.union([
      z.strictObject({ login: loginIdSchema }),
      z.strictObject({ filled: z.literal(true) }),
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

export const LOGIN_REQUEST_ROUTES = [
  loginRequestAsk,
  loginRequestRead,
  loginRequestCancel,
  loginRequestHold,
  loginRequestDone,
] as const;
