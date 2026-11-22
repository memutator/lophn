import { browserProfileIdSchema } from "../secrets/browser-vault.ts";

// browser profile의 partition. 정의(이름, 색)와 목록은 core의 vault(`protocol/secrets/browser-vault.ts`)이고 사람만 바꾼다.
// 기본 profile은 목록에 없고 id가 없다(null). 그 partition은 처음부터 쓰던 `persist:lophn-browser`라 기존 로그인이 남는다.
export {
  BROWSER_PROFILE_ID_PREFIX,
  BROWSER_PROFILES_MAX,
  type BrowserProfile,
  browserProfileIdSchema,
  browserProfileSchema,
} from "../secrets/browser-vault.ts";

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
