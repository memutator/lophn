import { canonicalize, sha256Hex } from "../../../base/mod.ts";

// 입력 schema가 기본값을 주는 칸이 그 기본값이면 내용 기준에서 뺀다(빠진 칸과 기본값은 같은 뜻이다).
// 그래서 기본값을 쓰는 결정의 내용 기준은 그 칸이 생기기 전과 같고, 기본값이 아닌 값을 고른 결정만
// 그 값에 묶인다. grant의 scope가 이 경우다: once handle로 session을 허락하지 못한다.
type InputSchema = {
  safeParse(value: unknown): { success: boolean; data?: unknown };
};

function atDefault(
  schema: InputSchema | undefined,
  record: Record<string, unknown>,
  field: string,
): boolean {
  const value = record[field];
  if (value === undefined) return true;
  if (schema === undefined) return false;
  const without = schema.safeParse({ ...record, [field]: undefined });
  if (!without.success) return false;
  const data = without.data as Record<string, unknown> | undefined;
  return data?.[field] !== undefined &&
    canonicalize(data[field]) === canonicalize(value);
}

// route가 선언한 binding field만 내용 기준으로 묶는다. field 순서는 선언 순서를 따른다.
// content는 canonical JSON의 sha256이라 등록 메시지 schema와 같다.
export async function confirmationBinding(
  route: { binding?: readonly string[]; input?: InputSchema },
  input: unknown,
): Promise<{ target: string; content: string } | undefined> {
  const fields = route.binding;
  if (fields === undefined || fields.length === 0) return undefined;
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const bound: Record<string, unknown> = {};
  for (const field of fields) {
    if (field !== fields[0] && atDefault(route.input, record, field)) continue;
    bound[field] = record[field];
  }
  const target = record[fields[0]];
  if (typeof target !== "string" || target.length === 0) return undefined;
  return { target, content: await sha256Hex(canonicalize(bound)) };
}
