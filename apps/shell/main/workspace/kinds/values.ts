// kind 선언이 함께 쓰는 값 모양이다. layout 파일의 탭 key·참조 형식과 힌트의 참조 읽기.
import { z } from "zod";

// 로컬 탭 참조. credential이 아니라 workspace 안 유일 key다(domain-model 제약).
export const tabKey = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

// 읽던 위치는 section key와 0 이상 scroll offset뿐이다. 본문은 없다(shell/workspace#R8).
export const readPositionSchema = z.strictObject({
  section: z.string().min(1).max(128),
  scroll_offset: z.number().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const documentId = z.string().regex(
  /^doc_[0-7][0-9a-hjkmnp-tv-z]{25}$/,
);
export const appId = z.string().regex(/^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/);

const ULID = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;

/** `<prefix>_<ulid>` 형식의 ID이면 그 값, 아니면 null. */
export function idOf(prefix: string, value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(`${prefix}_`)) return null;
  return ULID.test(value.slice(prefix.length + 1)) ? value : null;
}
