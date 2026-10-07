import { err, ok, type Result } from "../../base/mod.ts";

export type CursorState = {
  principal: string;
  app: string;
  problem: string;
  kind: string;
  source: string;
  fixed: string;
  offset: number;
  high_water: string;
};
export type RepairCursor = {
  encode(state: CursorState): Promise<string>;
  decode(value: string): Promise<Result<CursorState>>;
};
const encoder = new TextEncoder();
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}
export async function createRepairCursor(): Promise<RepairCursor> {
  const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return {
    async encode(state) {
      const body = encoder.encode(JSON.stringify(state));
      return `${encode(body)}.${encode(new Uint8Array(await crypto.subtle.sign("HMAC", key, body)))}`;
    },
    async decode(value) {
      const invalid = () => err({ code: "invalid_input" as const, message: "cursor가 올바르지 않다. 첫 페이지부터 다시 읽는다" });
      if (value.length > 4096) return invalid();
      try {
        const parts = value.split(".");
        if (parts.length !== 2) return invalid();
        const body = decode(parts[0]);
        if (!await crypto.subtle.verify("HMAC", key, decode(parts[1]), body)) return invalid();
        const state = JSON.parse(new TextDecoder().decode(body)) as CursorState;
        if (state === null || typeof state !== "object" || ["principal", "app", "problem", "kind", "source", "fixed", "high_water"].some((key) => typeof state[key as keyof CursorState] !== "string") || !Number.isSafeInteger(state.offset) || state.offset < 0 || !/^\d+$/.test(state.high_water)) return invalid();
        return ok(state);
      } catch {
        return invalid();
      }
    },
  };
}
