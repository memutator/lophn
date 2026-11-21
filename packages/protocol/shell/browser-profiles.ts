import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { AGENT_CHARACTER_COLORS } from "../base/character-colors.ts";

// browser profile 하나는 cookie·저장소 partition 하나와 그 profile의 저장 login이다. 기본 profile은 목록에 없고 id가 없다(null).
// 그 partition은 처음부터 쓰던 `persist:lophn-browser`라 기존 로그인이 남는다. 목록은 core 설정 `shell.browser_profiles`(사람만 바꾼다)다.
// `protocol/lophn-agent`와 `protocol/secrets`는 이 file을 import하지 않고 id 꼴(`idSchema("bpf")`)만 쓴다(protocol 최상위 영역 사이의 순환을 만들지 않는다).
export const BROWSER_PROFILES_SETTING = "shell.browser_profiles";
export const BROWSER_PROFILE_ID_PREFIX = "bpf";
export const browserProfileIdSchema = idSchema(BROWSER_PROFILE_ID_PREFIX);

export const browserProfileSchema = z.strictObject({
  id: browserProfileIdSchema,
  name: z.string().min(1).max(40),
  color: z.enum(AGENT_CHARACTER_COLORS),
});
export type BrowserProfile = z.infer<typeof browserProfileSchema>;

export const BROWSER_PROFILES_MAX = 16;
export const browserProfilesSchema = z
  .array(browserProfileSchema)
  .max(BROWSER_PROFILES_MAX)
  .refine(
    (list) =>
      new Set(list.map((profile) => profile.id)).size === list.length &&
      new Set(list.map((profile) => profile.name.toLowerCase())).size ===
        list.length,
    { message: "profile ids and names are unique" },
  );

export const DEFAULT_BROWSER_PARTITION = "persist:lophn-browser";

/** profile의 partition. null은 기본 profile이다. */
export function browserPartition(profile: string | null): string {
  return profile === null
    ? DEFAULT_BROWSER_PARTITION
    : `${DEFAULT_BROWSER_PARTITION}-${profile}`;
}

/** browser partition 글에서 profile을 푼다. 기본이면 null, browser partition이 아니면 undefined. */
export function profileOfPartition(
  partition: string,
): string | null | undefined {
  if (partition === DEFAULT_BROWSER_PARTITION) return null;
  const prefix = `${DEFAULT_BROWSER_PARTITION}-`;
  if (!partition.startsWith(prefix)) return undefined;
  const profile = partition.slice(prefix.length);
  return browserProfileIdSchema.safeParse(profile).success
    ? profile
    : undefined;
}
