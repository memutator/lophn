// IssuesSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output schema로
// 이미 검사했다. 상태 바꾸기는 확인 창 없이 사람이 바로 한다.
import type { ReleaseRecord } from "../../../../../protocol/apps/mod.ts";
import type {
  ProblemDetailView,
  ProblemListItem,
} from "../../../../../protocol/problems/mod.ts";
import type { CoreSource } from "../../../desktop/connection/connection.ts";
import { issueRowOf, issueViewOf, type ReleaseNumbers } from "./core-read.ts";
import type {
  IssueFilter,
  IssueRow,
  IssuesSource,
  SourceResult,
} from "./source.ts";

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 10;
/** 제보 글을 읽을 상한. */
const REPORT_TEXTS = 5;
const REPORT_BYTES = 4096;

async function call<T>(
  core: CoreSource,
  kind: "read" | "command",
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  const reply = await core.call({ kind, resource, method, body });
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
  return { ok: true, value: reply.value as T };
}

async function releaseNumbers(
  core: CoreSource,
  app: string,
): Promise<ReleaseNumbers> {
  const result = await call<{ releases: ReleaseRecord[] }>(
    core,
    "read",
    "releases",
    "list_records",
    { app, limit: 200 },
  );
  return new Map(
    result.ok
      ? result.value.releases.map((release) => [release.id, release.number])
      : [],
  );
}

export function coreIssuesSource(core: CoreSource): IssuesSource {
  return {
    async list(app, filter: IssueFilter) {
      const rows: IssueRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result = await call<
          { problems: ProblemListItem[]; next_cursor: string | null }
        >(core, "read", "problems", "list_problems", {
          app,
          ...(filter.status === null ? {} : { state: filter.status }),
          ...(filter.since === null ? {} : { since: filter.since }),
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!result.ok) return result;
        rows.push(...result.value.problems.map(issueRowOf));
        if (result.value.next_cursor === null) break;
        cursor = result.value.next_cursor;
      }
      return { ok: true, value: rows };
    },

    async get(problem) {
      const found = await call<ProblemDetailView>(
        core,
        "read",
        "problems",
        "get_problem",
        { problem },
      );
      if (!found.ok) return found;
      const value = found.value;
      const numbers = await releaseNumbers(core, value.problem.app);

      // 로그 조각은 snapshot에 로그가 있을 때만 읽는다. 못 읽으면 비워 둔다.
      let log: string | null = null;
      if (value.latest?.snapshot.logs != null) {
        const fragment = await call<
          { fragment: { kind: string; lines?: string[] } }
        >(core, "read", "problems", "get-snapshot-logs", {
          snapshot: value.latest.snapshot.id,
        });
        if (
          fragment.ok && fragment.value.fragment.kind === "fragment" &&
          fragment.value.fragment.lines !== undefined
        ) {
          log = fragment.value.fragment.lines.join("\n");
        }
      }

      // 사람이 쓴 제보 글.
      const texts = await Promise.all(
        value.occurrences.filter((item) => item.source === "feedback")
          .slice(0, REPORT_TEXTS)
          .map((item) =>
            call<{ status: string; text?: string }>(
              core,
              "read",
              "problems",
              "report_body",
              {
                report: item.report,
                field: "report_text",
                offset_bytes: 0,
                length_bytes: REPORT_BYTES,
              },
            )
          ),
      );
      const reports = texts.flatMap((text) =>
        text.ok && text.value.status === "available" &&
          text.value.text !== undefined
          ? [text.value.text]
          : []
      );
      return {
        ok: true,
        value: issueViewOf(value, numbers, { log, reports }),
      };
    },

    async setState(problem, state) {
      const key = crypto.randomUUID();
      const reply = await call(core, "command", "problems", "set_state", {
        input: { problem, state, key },
        idempotency_key: key,
        compare: {},
        prepared: [],
      });
      return reply.ok ? { ok: true, value: true } : reply;
    },
  };
}
