// platform의 canonical JSON과 같은 내용 기준. renderer는 packages/base를 import하지 않으므로
// 최소 규칙(키 정렬, 유한 수, plain object, cycle 거부)을 여기 둔다. 승인 요청이 고정하는
// input_hash·binding_hash는 이 문자열의 sha256 hex이고 core가 같은 규칙으로 다시 검사한다.

function serializeString(value: string): string {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("Canonical JSON rejects unpaired surrogates");
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError("Canonical JSON rejects unpaired surrogates");
    }
  }
  return JSON.stringify(value);
}

export function canonicalize(value: unknown): string {
  const ancestors = new Set<object>();

  function serialize(current: unknown): string {
    if (current === null) return "null";
    switch (typeof current) {
      case "boolean":
        return current ? "true" : "false";
      case "string":
        return serializeString(current);
      case "number":
        if (!Number.isFinite(current)) {
          throw new TypeError("Canonical JSON requires finite numbers");
        }
        return JSON.stringify(current);
      case "object": {
        if (ancestors.has(current)) {
          throw new TypeError("Canonical JSON rejects cycles");
        }
        ancestors.add(current);
        try {
          if (Array.isArray(current)) {
            return `[${current.map((item) => serialize(item)).join(",")}]`;
          }
          const prototype = Object.getPrototypeOf(current);
          if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError("Canonical JSON requires plain objects");
          }
          const object = current as Record<string, unknown>;
          const properties = Object.keys(object).sort().map((key) =>
            `${serializeString(key)}:${serialize(object[key])}`
          );
          return `{${properties.join(",")}}`;
        } finally {
          ancestors.delete(current);
        }
      }
      default:
        throw new TypeError("Canonical JSON requires JSON values");
    }
  }

  return serialize(value);
}

export async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
