// Hermes has no Web Crypto. The desktop logic the phone reuses names ids with `crypto.getRandomValues` (prefixed-id.ts)
// and makes idempotency keys with `crypto.randomUUID` (waiting/decide.ts), so the phone gives both from expo-crypto
// once at start, before any of that code runs.
import { getRandomValues, randomUUID } from "expo-crypto";

const scope = globalThis as { crypto?: Partial<Crypto> };
const crypto = scope.crypto ?? {};
crypto.getRandomValues ??= getRandomValues as Crypto["getRandomValues"];
crypto.randomUUID ??= randomUUID as Crypto["randomUUID"];
scope.crypto = crypto;
