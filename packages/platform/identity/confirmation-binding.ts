import { canonicalize, sha256Hex } from "../../base/mod.ts";

// route가 선언한 binding field만 내용 기준으로 묶는다. field 순서는 선언 순서를 따른다.
// content는 canonical JSON의 sha256이라 등록 메시지 schema와 같다.
export async function confirmationBinding(
  route: { binding?: readonly string[] },
  input: unknown,
): Promise<{ target: string; content: string } | undefined> {
  const fields = route.binding;
  if (fields === undefined || fields.length === 0) return undefined;
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const bound: Record<string, unknown> = {};
  for (const field of fields) bound[field] = record[field];
  const target = record[fields[0]];
  if (typeof target !== "string" || target.length === 0) return undefined;
  return { target, content: await sha256Hex(canonicalize(bound)) };
}
