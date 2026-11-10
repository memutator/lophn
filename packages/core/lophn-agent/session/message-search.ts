// SearchSessionMessages. 메시지 글은 blob에 있어 표에서 찾을 수 없다. 그래서 최근 메시지부터 blob을 읽어
// 사람이 쓴 말과 이 agent의 답 글에서 query를 찾는다(대소문자 구분 없음). 오래된 기록까지 모두 찾지는 않는다:
// 한 번에 최근 SCAN_MAX개만 보고, 결과가 MATCH_MAX개가 되면 멈춘다. blob hash가 같으면 한 번만 읽는다.
import { err, ok } from "../../../base/mod.ts";
import {
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  MESSAGE_CONTENT_MAX_BYTES,
  messageSearch,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ApiReadDefinition } from "../../../protocol/server/mod.ts";
import { bodyContentOf, readBodyBytes } from "./body-read.ts";
import type { MessageBodyEnvironment } from "./body-read.ts";
import { visibleSessions } from "./guards.ts";

/** 한 번에 훑는 최근 메시지 수. */
const SCAN_MAX = 200;
/** 돌려주는 결과 수. */
const MATCH_MAX = 20;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;

type Candidate = {
  readonly id: string;
  readonly session: string;
  readonly hash: string;
  readonly size: number | null;
  readonly at: string;
};

type Found = {
  readonly candidates: readonly Candidate[];
  readonly asOf: string;
};

function textOfParts(
  parts: readonly { kind: string; text?: string }[],
): string {
  return parts
    .flatMap((part) =>
      part.kind === "text" && part.text !== undefined ? [part.text] : [],
    )
    .join("\n");
}

/** 처음 맞은 곳 앞뒤를 한 줄로 줄인다. 줄바꿈과 이어진 공백은 한 칸으로 접는다. */
function snippetOf(text: string, needle: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(needle);
  if (at === -1) return null;
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(flat.length, at + needle.length + SNIPPET_AFTER);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

export function messageSearchRead(
  environment: MessageBodyEnvironment,
): ApiReadDefinition<typeof messageSearch> {
  return {
    route: messageSearch,
    async handle(ctx, input) {
      const parsed = messageSearch.input.safeParse(input);
      if (!parsed.success) {
        return err({ code: "invalid_input", message: "invalid read input" });
      }
      const { agent, workspace, query } = parsed.data;
      const scope = visibleSessions(ctx);
      if (scope === undefined) {
        return err({
          code: "forbidden",
          message: "this actor sees no session",
        });
      }
      const found = environment.snapshot<Found>((sql, asOfSeq) => {
        const clauses = [
          "s.agent = ?",
          "s.workspace_kind is ?",
          "s.workspace_id = ?",
          "m.from_kind in ('human', 'agent', 'app')",
        ];
        const params: (string | null)[] = [
          agent,
          workspace?.kind ?? null,
          workspace?.id ?? null,
        ];
        // agent는 자기 session만 본다(사람과 machine은 제한이 없다).
        if (scope !== null) {
          clauses.push("s.id = ?");
          params.push(scope);
        }
        const rows = sql.all(
          `select m.id, m.session, m.body, m.created_at, r.size_bytes
           from messages m
           join sessions s on s.id = m.session
           left join blob_refs r
             on r.owner_kind = ? and r.owner_key = m.id and r.field = ?
           where ${clauses.join(" and ")}
           order by m.created_seq desc
           limit ?`,
          [MESSAGE_BODY_OWNER_KIND, MESSAGE_BODY_FIELD, ...params, SCAN_MAX],
        );
        const candidates: Candidate[] = [];
        for (const row of rows) {
          const size = row["size_bytes"];
          candidates.push({
            id: String(row["id"]),
            session: String(row["session"]),
            hash: String(row["body"]),
            size:
              typeof size === "bigint"
                ? Number(size)
                : typeof size === "number"
                  ? size
                  : null,
            at: String(row["created_at"]),
          });
        }
        return ok({ candidates, asOf: asOfSeq });
      });
      if (!found.ok) return found;

      const needle = query.trim().toLowerCase();
      // 같은 본문을 여러 메시지가 가리킬 수 있다.
      const texts = new Map<string, string | null>();
      const matches: {
        session: string;
        message: string;
        at: string;
        snippet: string;
      }[] = [];
      for (const candidate of found.value.candidates) {
        if (matches.length >= MATCH_MAX) break;
        let text = texts.get(candidate.hash);
        if (text === undefined) {
          text = null;
          const { size } = candidate;
          if (size !== null && size > 0 && size <= MESSAGE_CONTENT_MAX_BYTES) {
            const bytes = await readBodyBytes(
              environment,
              candidate.hash,
              size,
            );
            if (bytes.ok) {
              const content = bodyContentOf(bytes.value);
              if (content.ok) text = textOfParts(content.value.parts);
            }
          }
          texts.set(candidate.hash, text);
        }
        if (text === null) continue;
        const snippet = snippetOf(text, needle);
        if (snippet === null) continue;
        matches.push({
          session: candidate.session,
          message: candidate.id,
          at: candidate.at,
          snippet,
        });
      }
      return ok({
        matches,
        as_of_seq: found.value.asOf,
        next_cursor: null,
      });
    },
  };
}
