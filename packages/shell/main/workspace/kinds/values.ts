// kind 선언이 함께 쓰는 값 모양이다. layout 파일의 탭 key와 참조 형식.
import { z } from "zod";

// 로컬 탭 참조. credential이 아니라 workspace 안 유일 key다. 파일 탭은 절대 경로가 key다.
export const tabKey = z.string().min(1).max(4096);

// 읽던 위치는 section key와 0 이상 scroll offset뿐이다. 본문은 없다.
export const readPositionSchema = z.strictObject({
  section: z.string().min(1).max(128),
  scroll_offset: z.number().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const appId = z.string().regex(/^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/);

const ULID = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;

/** `<prefix>_<ulid>` 형식의 ID이면 그 값, 아니면 null. */
export function idOf(prefix: string, value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(`${prefix}_`)) return null;
  return ULID.test(value.slice(prefix.length + 1)) ? value : null;
}

export const contextId = z.string().regex(/^ctx_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
export const savedViewId = z.string().regex(
  /^viw_[0-7][0-9a-hjkmnp-tv-z]{25}$/,
);

// Context 탭의 하위 탭. contracts/shell/workspace.ts의 CONTEXT_SUB_TABS와 같아야 한다(renderer
// registry 테스트가 대조한다).
export const CONTEXT_SUB_TABS = [
  "overview",
  "search",
  "violations",
  "glossary",
  "contract",
] as const;

// 선언된 검색의 입력 값: 문자열·숫자·문자열 목록·범위. 입력 16개 이하, 합쳐 4KiB 이하다.
const inputValue = z.union([
  z.string().max(1024),
  z.number().finite(),
  z.array(z.string().max(1024)).max(64),
  z.strictObject({
    from: z.union([z.string().max(1024), z.number().finite()]),
    to: z.union([z.string().max(1024), z.number().finite()]),
  }),
]);
export const SEARCH_INPUTS_MAX = 16;
export const SEARCH_INPUTS_MAX_BYTES = 4096;
export const searchInputs = z.record(z.string().min(1).max(128), inputValue)
  .refine((inputs) => Object.keys(inputs).length <= SEARCH_INPUTS_MAX, {
    message: "too many search inputs",
  })
  .refine(
    (inputs) =>
      new TextEncoder().encode(JSON.stringify(inputs)).length <=
        SEARCH_INPUTS_MAX_BYTES,
    { message: "search inputs exceed 4 KiB" },
  );
