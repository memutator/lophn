// 사람이 captured synthetic envelope를 넘기는 경계. network·임시 원문 파일은 없다.
import { isSecretKey, same, secretHits } from "./normalize.ts";
import { decodeChunk } from "./stream.ts";
import type { ResponseChunk } from "./types.ts";

type RecordRequest = {
  live: boolean;
  instructed: boolean;
  body: unknown;
  secrets: string[];
};
type RecordResult =
  | { ok: true; body: unknown }
  | {
    ok: false;
    reason: "live_disabled" | "not_instructed" | "secret" | "invalid_capture";
  };

export function recordFixture(request: RecordRequest): RecordResult {
  if (!request.instructed) return { ok: false, reason: "not_instructed" };
  if (!request.live) return { ok: false, reason: "live_disabled" };
  try {
    const body = project(request.body, request.secrets);
    return { ok: true, body };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof SecretError ? "secret" : "invalid_capture",
    };
  }
}

class SecretError extends Error {}

function scan(text: string, secrets: string[]): void {
  if (secretHits(text, secrets).length) throw new SecretError();
}

function project(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") {
    scan(value, secrets);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((child) => project(child, secrets));
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    scan(key, secrets);
    if (isSecretKey(key)) {
      out[key] = { present: true };
    } else if (key === "chunks") {
      out[key] = chunks(child, secrets);
    } else if (key === "body" && typeof child === "string") {
      out[key] = protocolBody(child, secrets);
    } else {
      out[key] = project(child, secrets);
    }
  }
  return out;
}

function protocolBody(text: string, secrets: string[]): string {
  if (text === "") return text;
  // SSE 전체를 먼저 decode하므로 secret이 frame/chunk/JSON escape를 건너도 검사한다.
  if (/^(?:event:|data:|:|id:|retry:)/.test(text)) return sse(text, secrets);
  const parsed = JSON.parse(text);
  const safe = project(parsed, secrets);
  return same(parsed, safe) ? text : JSON.stringify(safe);
}

function sse(text: string, secrets: string[]): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const normalized = text.replaceAll("\r\n", "\n");
  if (normalized.includes("\r") || !normalized.endsWith("\n\n")) {
    throw new Error();
  }
  const events = normalized.slice(0, -2).split("\n\n");
  return events.map((event) => {
    const lines = event.split("\n");
    const data: string[] = [];
    for (const line of lines) {
      if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      else {
        if (!/^(?:event:|id:|retry:|:)/.test(line)) throw new Error();
        scan(line, secrets);
      }
    }
    if (!data.length) throw new Error();
    const joined = data.join("\n");
    if (joined === "[DONE]") return event.replaceAll("\n", newline);
    const parsed = JSON.parse(joined);
    const safe = project(parsed, secrets);
    if (same(parsed, safe)) return event.replaceAll("\n", newline);
    const redacted = JSON.stringify(safe);
    scan(redacted, secrets);
    let replaced = false;
    return lines.flatMap((line) => {
      if (!line.startsWith("data:")) return [line];
      if (replaced) return [];
      replaced = true;
      return [`data: ${redacted}`];
    }).join(newline);
  }).join(newline + newline) + newline + newline;
}

function chunks(value: unknown, secrets: string[]): ResponseChunk[] {
  if (!Array.isArray(value)) throw new Error();
  const parts = value.map((chunk) => {
    if (
      !chunk || typeof chunk !== "object" || typeof chunk.bytes !== "string"
    ) throw new Error();
    if (
      chunk.encoding !== undefined && chunk.encoding !== "utf8" &&
      chunk.encoding !== "base64"
    ) throw new Error();
    if (
      chunk.encoding === "base64" && btoa(atob(chunk.bytes)) !== chunk.bytes
    ) throw new Error();
    return decodeChunk(chunk);
  });
  const combined = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(combined);
  const encoded = new TextEncoder().encode(protocolBody(text, secrets));
  const unchanged = new TextDecoder().decode(encoded) === text;
  offset = 0;
  // chunk 수·delay·gate·reset/header는 보존한다. redaction 길이가 바뀌면 마지막 chunk가 remainder다.
  return value.map((chunk, index) => {
    const end = index === value.length - 1
      ? encoded.length
      : Math.min(offset + parts[index].length, encoded.length);
    const bytes = btoa(String.fromCharCode(...encoded.subarray(offset, end)));
    offset = end;
    const metadata = { ...chunk };
    delete metadata.bytes;
    delete metadata.encoding;
    const safe = project(metadata, secrets) as Omit<
      ResponseChunk,
      "bytes" | "encoding"
    >;
    if (unchanged) {
      return {
        ...safe,
        bytes: chunk.bytes,
        ...(chunk.encoding ? { encoding: chunk.encoding } : {}),
      };
    }
    return { ...safe, bytes, encoding: "base64" };
  });
}
