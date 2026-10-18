import { canonicalize, sha256Hex } from "../../../packages/base/mod.ts";

export function hashText(text: string): Promise<string> {
  return sha256Hex(text);
}

export function hashValue(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}

// 경로 → 글.
export function hashBundle(files: Record<string, string>): Promise<string> {
  return hashValue(files);
}

// registry content용. key를 정렬한 정규 형태를 2칸 들여쓰기로 쓴다.
export function prettyJson(value: unknown): string {
  return JSON.stringify(JSON.parse(canonicalize(value)), null, 2);
}
