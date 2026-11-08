import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { wrapUntrusted } from "../../../../protocol/lophn-agent/input-tags.ts";
import { fail } from "../file/scope.ts";
import type { ToolContext } from "../tool-context.ts";
import { checkFetchTarget } from "./target.ts";

const BODY_MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(x?)([0-9a-f]+);/gi, (whole, hex: string, code: string) => {
      const point = parseInt(code, hex ? 16 : 10);
      return point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : whole;
    })
    .replace(/&amp;/g, "&");
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/(p|div|li|tr|h[1-6]|br)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

async function readCapped(
  response: Response,
): Promise<{ text: string; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  if (response.body !== null) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = BODY_MAX_BYTES - size;
      if (value.length > room) {
        chunks.push(value.slice(0, room));
        size += room;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      size += value.length;
    }
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { text: new TextDecoder("utf-8").decode(bytes), truncated };
}

export async function fetchUrl(
  input: { url: string },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  let current = input.url;
  let response: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const checked = checkFetchTarget(current);
    if (!checked.ok) return checked;
    try {
      response = await ctx.fetch(checked.value, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "lophn", accept: "text/*, application/json" },
      });
    } catch {
      return fail("unavailable", "the request failed");
    }
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || location === null) {
      break;
    }
    await response.body?.cancel();
    if (hop === MAX_REDIRECTS) return fail("unavailable", "too many redirects");
    try {
      current = new URL(location, checked.value).href;
    } catch {
      return fail("unavailable", "invalid redirect");
    }
  }
  if (response === null) return fail("unavailable", "the request failed");
  if (!response.ok) {
    await response.body?.cancel();
    return fail(
      response.status === 404 ? "not_found" : "unavailable",
      `http ${response.status}`,
    );
  }

  const type = response.headers.get("content-type") ?? "";
  if (!/^(text\/|application\/(json|xml|xhtml))/i.test(type) && type !== "") {
    await response.body?.cancel();
    return fail("invalid_input", `cannot read content type ${type}`);
  }
  const body = await readCapped(response);
  const text = /html/i.test(type) ? htmlToText(body.text) : body.text;
  return ok({
    status: "success",
    summary: `fetched ${current}`,
    content: wrapUntrusted("web.fetch", text),
    complete: !body.truncated,
    source: {
      target: current,
      version: null,
      range: null,
      original_bytes: null,
      original_lines: null,
      omitted_count: null,
    },
    continuation: null,
    pending: [],
  });
}
