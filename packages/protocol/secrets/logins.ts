import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";

// site login 하나의 metadata는 `<data root>/browser-vault.json`(browser-vault.ts)에 있고 값은 `secrets.json`의
// `login.<id>.password|totp`다. 값은 `secrets/put`(보호 입력 창)으로 넣는다. login은 browser profile 하나에 속하고
// 그 profile의 탭에서만 list·fill된다. profile은 id 꼴만 쓴다(browser-vault.ts가 이 file을 import한다). null은 기본 profile이다.

export const LOGIN_ID_PREFIX = "lgn";
export const loginIdSchema = z
  .string()
  .regex(new RegExp(`^${LOGIN_ID_PREFIX}_[0-7][0-9a-hjkmnp-tv-z]{25}$`));

export const LOGIN_FIELDS = ["password", "totp"] as const;
export const loginFieldSchema = z.enum(LOGIN_FIELDS);
export type LoginField = z.infer<typeof loginFieldSchema>;

export const LOGIN_SECRET_PREFIX = "login.";
export const loginSecretName = (id: string, field: LoginField) =>
  `${LOGIN_SECRET_PREFIX}${id}.${field}`;

// 정규화한 origin(`URL(origin).origin`)과 글자가 같아야 한다. 값을 내주는 비교가 이 글자 일치다.
export const loginOriginSchema = z.string().refine(
  (value) => {
    if (!URL.canParse(value)) return false;
    return new URL(value).origin === value;
  },
  { message: "origin must be scheme://host[:port] as URL.origin" },
);

const loginProfileSchema = idSchema("bpf").nullable();

const loginSchema = z.strictObject({
  id: loginIdSchema,
  label: z.string().min(1).max(100),
  origin: loginOriginSchema,
  username: z.string().max(200),
  note: z.string().max(1000),
  profile: loginProfileSchema,
});
export type Login = z.infer<typeof loginSchema>;

const loginView = loginSchema.extend({ totp: z.boolean() });

// agent는 `tab`이 있으면 그 탭(자기 탭)의 profile, 없으면 자기 agent 정의의 profile에 든 login만 받는다.
// 사람은 `tab`이 있으면 그 탭(사람의 탭)의 profile, 없으면 전부를 받는다.
export const loginsList = defineMemory({
  resource: "logins",
  method: "list",
  name: "LoginsList",
  input: z.strictObject({
    origin: loginOriginSchema.optional(),
    tab: idSchema("tab").optional(),
  }),
  output: z.array(loginView),
  reads: ["logins"],
  actors: ["user", "agent"],
  errors: ["invalid_input", "not_found", "unavailable"],
});

// `profile`은 새 login에만 쓴다(없으면 기본). 있는 login을 고칠 때는 그 login의 profile을 그대로 둔다.
export const loginsSave = defineMemory({
  resource: "logins",
  method: "save",
  name: "LoginsSave",
  changes: [{ name: "logins", id: (_input, output) => output.id }],
  input: z.strictObject({
    id: loginIdSchema.optional(),
    label: loginSchema.shape.label,
    origin: loginOriginSchema,
    username: loginSchema.shape.username,
    note: loginSchema.shape.note.optional(),
    profile: loginProfileSchema.optional(),
  }),
  output: z.strictObject({ id: loginIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "not_found", "unavailable"],
});

export const loginsDelete = defineMemory({
  resource: "logins",
  method: "delete",
  name: "LoginsDelete",
  changes: [{ name: "logins", id: (input) => input.id }],
  input: z.strictObject({ id: loginIdSchema }),
  output: z.strictObject({ id: loginIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "not_found", "unavailable"],
});

// shell main만 값을 받는다. HTTP user token만으로는 못 부르고 `connect {client: shell}`이 준 capability를
// 입력에 실어야 한다(handler는 요청 header를 보지 못한다). renderer 일반 통로는 capability를 모른다.
// origin은 shell main이 ref 요소가 든 frame에서 잰 값이고 core가 저장된 origin과 글자 그대로 비교한다.
// profile은 그 page의 browser profile이고 login의 profile과 다르면 내주지 않는다.
// 값은 이 route의 응답에만 있다. totp면 지금 6자리 code다.
export const loginsRelease = defineMemory({
  resource: "logins",
  method: "release",
  name: "LoginsRelease",
  input: z.strictObject({
    id: loginIdSchema,
    field: loginFieldSchema,
    origin: loginOriginSchema,
    profile: loginProfileSchema,
    // 모양은 supervision의 shellCapabilitySchema와 같지만 protocol 최상위 순환 때문에 가져오지 못한다. 맞는지는 core가 살아 있는 값과 대조한다.
    shell_capability: z.string().min(1),
  }),
  output: z.strictObject({ value: z.string() }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

export const LOGIN_ROUTES = [
  loginsList,
  loginsSave,
  loginsDelete,
  loginsRelease,
] as const;
