import { z } from "zod";
import { AGENT_CHARACTER_COLORS } from "../base/character-colors.ts";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { loginIdSchema, loginOriginSchema } from "./logins.ts";

// browser profile 정의(이름, 색)와 저장 login metadata는 `<data root>/browser-vault.json`(0600) 하나다. 값은 `secrets.json`의
// `login.<id>.password|totp`다. 사람의 컴퓨터들(명단의 컴퓨터)이 서로의 vault를 link로 받아 칸마다 합친다.
// 그래서 칸마다 마지막으로 바꾼 stamp(`revs`)를 두고, 지운 것은 흔적(`removed`)으로 남긴다.
// stamp는 ms 수다. 바꾸는 컴퓨터가 max(지금, vault에서 본 가장 큰 stamp + 1)을 쓰므로 받은 변경보다 늘 크다.
// 같은 stamp면 값의 글자 순서가 큰 쪽이다(어느 컴퓨터에서 합쳐도 같다).
export const BROWSER_VAULT_FILE_NAME = "browser-vault.json";
// 이 컴퓨터가 vault를 명단의 다른 컴퓨터와 맞추는지(기본 켬, 사람만 바꾼다).
export const BROWSER_SHARE_SETTING = "shell.browser.share_with_computers";

// browser profile 하나는 cookie·저장소 partition 하나와 그 profile의 저장 login이다. 기본 profile은 목록에 없고 id가 없다(null).
export const BROWSER_PROFILE_ID_PREFIX = "bpf";
export const browserProfileIdSchema = idSchema(BROWSER_PROFILE_ID_PREFIX);
export const BROWSER_PROFILE_NAME_MAX = 40;
export const browserProfileSchema = z.strictObject({
  id: browserProfileIdSchema,
  name: z.string().min(1).max(BROWSER_PROFILE_NAME_MAX),
  color: z.enum(AGENT_CHARACTER_COLORS),
});
export type BrowserProfile = z.infer<typeof browserProfileSchema>;
// 이 컴퓨터에서 만들 수 있는 수다. 다른 컴퓨터와 합친 목록은 이보다 많을 수 있다(합치기는 버리지 않는다).
export const BROWSER_PROFILES_MAX = 16;

const stampSchema = z.number().int().nonnegative();
export const PROFILE_FIELDS = ["name", "color"] as const;
export const LOGIN_META_FIELDS = [
  "label",
  "origin",
  "username",
  "note",
] as const;
export const LOGIN_VALUE_FIELDS = ["password", "totp"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type LoginMetaField = (typeof LOGIN_META_FIELDS)[number];
export type LoginValueField = (typeof LOGIN_VALUE_FIELDS)[number];

const revsOf = <F extends readonly [string, ...string[]]>(fields: F) =>
  z.strictObject(
    Object.fromEntries(fields.map((field) => [field, stampSchema])) as {
      [K in F[number]]: typeof stampSchema;
    },
  );

export const vaultProfileSchema = browserProfileSchema.extend({
  revs: revsOf(PROFILE_FIELDS),
});
export type VaultProfile = z.infer<typeof vaultProfileSchema>;

// `profile`이 없으면 기본 profile의 login이다. login의 profile은 만든 뒤 바뀌지 않아 stamp가 없다.
// password·totp의 stamp는 값이 있든 없든 그 값을 마지막으로 바꾼(넣은, 지운) 때다.
export const vaultLoginSchema = z.strictObject({
  id: loginIdSchema,
  label: z.string().min(1).max(100),
  origin: loginOriginSchema,
  username: z.string().max(200),
  note: z.string().max(1000),
  profile: browserProfileIdSchema.optional(),
  revs: revsOf([...LOGIN_META_FIELDS, ...LOGIN_VALUE_FIELDS]),
});
export type VaultLogin = z.infer<typeof vaultLoginSchema>;

// 지운 profile·login의 흔적. `seen`은 지울 때 본 칸마다의 stamp다. 그보다 새 칸을 가진 사본(지울 때 몰랐던 고침)이
// 오면 그 항목이 되살아난다.
export const vaultRemovedSchema = z.strictObject({
  id: z.union([browserProfileIdSchema, loginIdSchema]),
  at: stampSchema,
  seen: z.record(z.string(), stampSchema),
});
export type VaultRemoved = z.infer<typeof vaultRemovedSchema>;

export const vaultFileSchema = z.strictObject({
  format: z.literal(1),
  profiles: z.array(vaultProfileSchema),
  logins: z.array(vaultLoginSchema),
  removed: z.array(vaultRemovedSchema),
  // 다른 컴퓨터에서 지워져 합치기가 지운 profile. 이 컴퓨터의 shell main이 그 partition data를 지우고 `cleared`로 뺀다.
  clear: z.array(browserProfileIdSchema),
});
export type VaultFile = z.infer<typeof vaultFileSchema>;

export const browserProfilesList = defineMemory({
  resource: "browser_profiles",
  method: "list",
  name: "BrowserProfilesList",
  input: z.strictObject({}),
  output: z.strictObject({
    profiles: z.array(browserProfileSchema),
    // partition data를 지울 profile(다른 컴퓨터에서 지웠다). shell main만 쓴다.
    clear: z.array(browserProfileIdSchema),
  }),
  reads: ["browser_profiles"],
  actors: ["user"],
  errors: ["invalid_input", "unavailable"],
});

// id가 없으면 새 profile이다. 이름은 이 컴퓨터의 목록에서 대소문자를 무시하고 겹치지 않아야 한다.
export const browserProfilesSave = defineMemory({
  resource: "browser_profiles",
  method: "save",
  name: "BrowserProfilesSave",
  changes: [{ name: "browser_profiles", id: (_input, output) => output.id }],
  input: z.strictObject({
    id: browserProfileIdSchema.optional(),
    name: browserProfileSchema.shape.name,
    color: browserProfileSchema.shape.color,
  }),
  output: z.strictObject({ id: browserProfileIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "not_found", "conflict", "unavailable"],
});

// profile과 그 profile의 login(값 포함)을 지운다. partition data는 부른 쪽(Settings)이 먼저 지운다.
export const browserProfilesDelete = defineMemory({
  resource: "browser_profiles",
  method: "delete",
  name: "BrowserProfilesDelete",
  changes: [{ name: "browser_profiles", id: (input) => input.id }, "logins"],
  input: z.strictObject({ id: browserProfileIdSchema }),
  output: z.strictObject({ id: browserProfileIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "not_found", "unavailable"],
});

// shell main이 partition data를 지운 profile을 `clear`에서 뺀다.
export const browserProfilesCleared = defineMemory({
  resource: "browser_profiles",
  method: "cleared",
  name: "BrowserProfilesCleared",
  changes: ["browser_profiles"],
  input: z.strictObject({ ids: z.array(browserProfileIdSchema).max(256) }),
  output: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "unavailable"],
});

// 명단의 다른 컴퓨터의 core가 이 컴퓨터의 vault를 값과 함께 받는다. 그 컴퓨터의 core 자신만(요청한 쪽 없이) 부르고
// 사람·agent·앱·터미널·폰과 이 컴퓨터의 사람 token은 받지 않는다(core/remote/call.ts, handler). 값은 이 응답에만 있다.
// 이 컴퓨터가 나누기를 껐으면 `forbidden`이다.
export const exchangeLoginSchema = vaultLoginSchema.extend({
  password: z.string().nullable(),
  totp: z.string().nullable(),
});
export type ExchangeLogin = z.infer<typeof exchangeLoginSchema>;
export const browserVaultExchange = defineMemory({
  resource: "browser_vault",
  method: "exchange",
  name: "BrowserVaultExchange",
  input: z.strictObject({}),
  output: z.strictObject({
    profiles: z.array(vaultProfileSchema),
    logins: z.array(exchangeLoginSchema),
    removed: z.array(vaultRemovedSchema),
  }),
  actors: ["user"],
  errors: ["forbidden", "unavailable"],
});

export const BROWSER_VAULT_ROUTES = [
  browserProfilesList,
  browserProfilesSave,
  browserProfilesDelete,
  browserProfilesCleared,
  browserVaultExchange,
] as const;
