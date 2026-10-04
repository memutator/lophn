import { createHash } from "node:crypto";
import { canonicalize } from "../../base/mod.ts";

// transaction 안에서 IO 없이 bounded canonical JSON을 검증한다.
const MAX_CANONICAL_BYTES = 256 * 1024;

function boundedJson(value: unknown): void {
  let budget = MAX_CANONICAL_BYTES;
  let nodes = 0;
  const active = new Set<object>();
  const consume = (text: string) => {
    if (text.length > budget) throw new RangeError("test JSON exceeds bound");
    budget -= new TextEncoder().encode(text).byteLength;
    if (budget < 0) throw new RangeError("test JSON exceeds bound");
  };
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 16384 || depth > 32) {
      throw new RangeError("test JSON exceeds bound");
    }
    if (item === null || typeof item === "boolean") {
      budget -= 5;
      return;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      budget -= 24;
      return;
    }
    if (typeof item === "string") {
      consume(item);
      budget -= 2;
      return;
    }
    if (typeof item !== "object" || !item || active.has(item)) {
      throw new TypeError("test JSON must be plain");
    }
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    ) throw new TypeError("test JSON must be plain");
    const array = Array.isArray(item);
    if (array && item.length > 16384) {
      throw new RangeError("test JSON array exceeds bound");
    }
    active.add(item);
    const keys = array
      ? Object.getOwnPropertyNames(item).filter((key) => key !== "length")
      : Object.keys(item);
    if (array) {
      if (keys.length !== item.length) {
        throw new TypeError(
          "test JSON array must not have holes or extra keys",
        );
      }
      for (let index = 0; index < item.length; index++) {
        const property = Object.getOwnPropertyDescriptor(item, String(index));
        if (!property || !("value" in property)) {
          throw new TypeError("test JSON array must have own data indices");
        }
      }
    }
    if (keys.length > 16384 || Object.getOwnPropertySymbols(item).length > 0) {
      throw new RangeError("test JSON exceeds bound");
    }
    for (const key of keys) {
      const property = Object.getOwnPropertyDescriptor(item, key);
      if (!property || !("value" in property)) {
        throw new TypeError("test JSON must not have accessors");
      }
      consume(key);
      budget -= 4;
      visit(property.value, depth + 1);
    }
    active.delete(item);
    if (budget < 0) throw new RangeError("test JSON exceeds bound");
  };
  visit(value, 0);
}

export function canonicalJson(value: unknown): string {
  boundedJson(value);
  const canonical = canonicalize(value);
  if (new TextEncoder().encode(canonical).byteLength > MAX_CANONICAL_BYTES) {
    throw new RangeError("test canonical JSON exceeds bound");
  }
  return canonical;
}

export function canonicalHash(value: unknown): string {
  return hashCanonical(canonicalJson(value));
}

export function hashCanonical(canonical: string): string {
  if (new TextEncoder().encode(canonical).byteLength > MAX_CANONICAL_BYTES) {
    throw new RangeError("test canonical JSON exceeds bound");
  }
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
