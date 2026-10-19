import { canonicalize } from "../../../../base/mod.ts";
import { sha256Text } from "../index/hash.ts";

// cursor는 `offset:fingerprint`다. fingerprint는 질의 모양의 지문이라 다른 질의의 cursor는 거절된다.
export const fingerprintOf = (value: unknown): string =>
  sha256Text(canonicalize(value)).slice(0, 16);

export const DEFAULT_LIMIT = 50;

// cursor가 이 질의의 것이 아니거나 범위를 벗어나면 null.
export function paginate<T>(
  items: readonly T[],
  limit: number,
  cursor: string | undefined,
  fingerprint: string,
): { items: T[]; next_cursor: string | null } | null {
  let offset = 0;
  if (cursor !== undefined) {
    const match = /^(\d+):([\s\S]*)$/.exec(cursor);
    if (match === null || match[2] !== fingerprint) return null;
    offset = Number(match[1]);
    if (!Number.isSafeInteger(offset) || offset > items.length) return null;
  }
  const end = offset + limit;
  return {
    items: items.slice(offset, end),
    next_cursor: end < items.length ? `${end}:${fingerprint}` : null,
  };
}
