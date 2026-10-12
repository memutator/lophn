// 화면 context 입력의 검사(apps/agent-context#R1, R2, R5). release bundle에 들어가는 플랫폼 진입
// 파일이라 의존성이 없다(Zod·npm 금지). 값의 정본은 packages/contracts/apps/agent-context.ts이고
// schema_test.ts가 같은 모양인지 확인한다.

export const SUMMARY_MAX_BYTES = 2048;

export type ReadInput = {
  screen: string;
  view_session: string;
  detail: boolean;
};

// 업무별 추가 필드는 command의 InputSchema가 따로 선언하므로 알려진 필드 밖은 `input`에 그대로 둔다.
export type WriteInput = {
  screen: string;
  view_session: string;
  expected_revision: string;
  target: string;
  text: string;
  input: Record<string, unknown>;
};

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

const encoder = new TextEncoder();

export function utf8Length(text: string): number {
  return encoder.encode(text).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 불투명 값: 비어 있지 않고 제어 문자가 없다.
export function isOpaque(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    !/\p{Cc}/u.test(value);
}

function loneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

// RFC 6901. 각 segment의 ~ 는 ~0 또는 ~1로만 끝난다.
export function isPointer(value: unknown): value is string {
  if (typeof value !== "string" || loneSurrogate(value)) return false;
  if (value === "") return true;
  if (!value.startsWith("/")) return false;
  return value.split("/").slice(1).every((part) => !/~(?![01])/.test(part));
}

export function pointerTokens(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer.split("/").slice(1).map((part) =>
    part.replaceAll("~1", "/").replaceAll("~0", "~")
  );
}

export function pointerOf(tokens: readonly string[]): string {
  return tokens.map((token) =>
    "/" + token.replaceAll("~", "~0").replaceAll("/", "~1")
  ).join("");
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function parseReadInput(raw: unknown): Parsed<ReadInput> {
  if (!isRecord(raw)) {
    return { ok: false, message: "screen context input must be an object" };
  }
  for (const key of Object.keys(raw)) {
    if (key !== "screen" && key !== "view_session" && key !== "detail") {
      return { ok: false, message: "screen context input has unknown fields" };
    }
  }
  if (!nonEmpty(raw.screen)) {
    return { ok: false, message: "screen must be a nonblank string" };
  }
  if (!isOpaque(raw.view_session)) {
    return { ok: false, message: "view_session must be an opaque string" };
  }
  if (raw.detail !== undefined && typeof raw.detail !== "boolean") {
    return { ok: false, message: "detail must be a boolean" };
  }
  return {
    ok: true,
    value: {
      screen: raw.screen,
      view_session: raw.view_session,
      detail: raw.detail === true,
    },
  };
}

export function parseWriteInput(raw: unknown): Parsed<WriteInput> {
  if (!isRecord(raw)) {
    return { ok: false, message: "annotation input must be an object" };
  }
  if (!nonEmpty(raw.screen)) {
    return { ok: false, message: "screen must be a nonblank string" };
  }
  if (!isOpaque(raw.view_session)) {
    return { ok: false, message: "view_session must be an opaque string" };
  }
  if (!isOpaque(raw.expected_revision)) {
    return { ok: false, message: "expected_revision must be an opaque string" };
  }
  if (!nonEmpty(raw.target)) {
    return { ok: false, message: "target must be a nonblank string" };
  }
  if (typeof raw.text !== "string") {
    return { ok: false, message: "text must be a string" };
  }
  return {
    ok: true,
    value: {
      screen: raw.screen,
      view_session: raw.view_session,
      expected_revision: raw.expected_revision,
      target: raw.target,
      text: raw.text,
      input: raw,
    },
  };
}
