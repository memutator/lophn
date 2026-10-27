import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { wrapUntrusted } from "../../prompt-assembly/input-tags.ts";
import { fail } from "../file/scope.ts";
import type { ToolContext } from "../tool-context.ts";
import { decodeEntities } from "./fetch.ts";

// 검색 endpoint는 여기 한 곳이다. key 없이 쓰는 Brave Search의 HTML 결과 쪽을 읽는다.
// 쪽 모양이 바뀌면 이 file의 parse만 고친다.
const ENDPOINT = "https://search.brave.com/search";
const MAX_RESULTS = 10;
const TIMEOUT_MS = 20_000;

type Hit = { title: string; url: string; snippet: string };

function plain(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function parse(html: string): Hit[] {
  const hits: Hit[] = [];
  for (const block of html.split('data-type="web"').slice(1)) {
    const url = block.match(/<a href="(https?:\/\/[^"]+)"/)?.[1];
    const title =
      block.match(
        /class="title[^"]*search-snippet-title[^"]*"[^>]*>([\s\S]*?)<\/div>/,
      )?.[1] ?? block.match(/class="title[^"]*"[^>]*title="([^"]*)"/)?.[1];
    if (url === undefined || title === undefined) continue;
    const snippet =
      block.match(/class="content[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    hits.push({
      title: plain(title),
      url: decodeEntities(url),
      snippet: plain(snippet),
    });
    if (hits.length >= MAX_RESULTS) break;
  }
  return hits;
}

export async function searchWeb(
  input: { query: string },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  let html: string;
  try {
    const response = await ctx.fetch(
      `${ENDPOINT}?${new URLSearchParams({ q: input.query })}`,
      {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "user-agent": "Mozilla/5.0 (X11; Linux x86_64) lophn",
          accept: "text/html",
        },
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return fail("unavailable", `search failed: http ${response.status}`);
    }
    html = await response.text();
  } catch {
    return fail("unavailable", "search failed");
  }
  const hits = parse(html);
  const text =
    hits.length === 0
      ? "No results."
      : hits
          .map(
            (hit, index) =>
              `${index + 1}. ${hit.title}\n${hit.url}\n${hit.snippet}`,
          )
          .join("\n\n");
  return ok({
    status: "success",
    summary: `${hits.length} results for ${input.query.slice(0, 100)}`,
    content: wrapUntrusted("web.search", text),
    complete: true,
    source: null,
    continuation: null,
    pending: [],
  });
}
