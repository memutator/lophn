// 내부 trace 이름. invocation ID와 구별하고 64자까지만 받는다.
export const TRACE_NAME_MAX_CHARS = 64;

export function traceName(name: string): string {
  if (name.length === 0 || name.length > TRACE_NAME_MAX_CHARS) {
    throw new Error("trace name must be 1 to 64 characters");
  }
  if (name.startsWith("inv_")) {
    throw new Error("trace name is not an invocation id");
  }
  return name;
}
