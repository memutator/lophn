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

  function serialize(value: unknown): string {
    if (value === null) return "null";
    switch (typeof value) {
      case "boolean":
        return value ? "true" : "false";
      case "string":
        return serializeString(value);
      case "number":
        if (!Number.isFinite(value)) {
          throw new TypeError("Canonical JSON requires finite numbers");
        }
        return JSON.stringify(value);
      case "object": {
        if (ancestors.has(value)) {
          throw new TypeError("Canonical JSON rejects cycles");
        }
        if (Object.getOwnPropertySymbols(value).length > 0) {
          throw new TypeError("Canonical JSON rejects symbol keys");
        }
        ancestors.add(value);
        try {
          if (Array.isArray(value)) {
            const items: string[] = [];
            for (let index = 0; index < value.length; index++) {
              items.push(serialize(value[index]));
            }
            return `[${items.join(",")}]`;
          }
          const prototype = Object.getPrototypeOf(value);
          if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError("Canonical JSON requires plain objects");
          }
          const object = value as Record<string, unknown>;
          const properties = Object.keys(object).sort().map((key) =>
            `${serializeString(key)}:${serialize(object[key])}`
          );
          return `{${properties.join(",")}}`;
        } finally {
          ancestors.delete(value);
        }
      }
      default:
        throw new TypeError("Canonical JSON requires JSON values");
    }
  }

  return serialize(value);
}
