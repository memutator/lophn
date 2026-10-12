// 수리 자료 읽기 port를 core RPC client 위에 얹는다(repair-context#R1, R19). 요청자의 connection
// credential로 부르는 client라 범위 밖 대상은 core가 없는 대상과 같은 답으로 거절한다. 이 port는
// ledger·앱 DB·원본 파일을 직접 열지 않는다.
import { err, ok, type Result } from "../../base/mod.ts";
import type { ReadRoute, Route } from "../../protocol/server/mod.ts";
import {
  getProblem,
  getReport,
  listProblemFixes,
  listProblems,
  listReports,
  listVerifications,
  reportBody,
} from "../../protocol/problems/mod.ts";
import {
  invocationsGet,
  releasesGet,
  releasesList,
} from "../../protocol/apps/mod.ts";
import { ticketShow } from "../../protocol/coding-agent/mod.ts";
import type { BlobText, RepairReadPort } from "./model.ts";

export type RepairReadClient = {
  read(route: Route, input: unknown): Promise<Result<unknown>>;
};

export type RepairReadPortOptions = {
  client: RepairReadClient;
  now(): string;
  // core 알려진 값 pipe를 지난 글. 끝내지 못하면 null.
  redact(text: string): Promise<string | null>;
  // 기본은 일반 blob read route다. core가 그 owner·field를 이 연결에 열지 않으면 이유만 돌려준다.
  blob?(
    ref: { owner_kind: string; owner_key: string; field: string },
    maxBytes: number,
  ): Promise<BlobText>;
};

const RELEASE_LIST_LIMIT = 200;
const PROBLEM_LIST_LIMIT = 100;

async function parsed<R extends ReadRoute>(
  client: RepairReadClient,
  route: R,
  input: unknown,
): Promise<Result<ReturnType<R["output"]["parse"]>>> {
  const read = await client.read(route, input);
  if (!read.ok) return read;
  const output = route.output.safeParse(read.value);
  if (!output.success) {
    return err({
      code: "unavailable",
      message: "읽기 응답이 contract와 다르다",
    });
  }
  return ok(output.data as ReturnType<R["output"]["parse"]>);
}

async function defaultBlob(
  client: RepairReadClient,
  ref: { owner_kind: string; owner_key: string; field: string },
  maxBytes: number,
): Promise<BlobText> {
  const read = await parsed(client, reportBody, {
    report: ref.owner_key,
    field: ref.field,
    offset_bytes: 0,
    length_bytes: maxBytes,
  });
  if (!read.ok) {
    return {
      kind: "unavailable",
      reason: read.error.code === "unavailable"
        ? "blob 읽기 일시 장애"
        : "이 연결로 읽을 수 없다(blob 읽기 통로가 없거나 범위 밖)",
    };
  }
  const result = read.value;
  if (result.status === "unavailable") {
    return { kind: "unavailable", reason: `blob ${result.reason}` };
  }
  return {
    kind: "text",
    text: result.text,
    truncated: result.truncated,
  };
}

export function createRepairReadPort(
  options: RepairReadPortOptions,
): RepairReadPort {
  const { client } = options;
  return {
    now: options.now,
    redact: options.redact,
    problem: (id) => parsed(client, getProblem, { problem: id }),
    reports: (problem, cursor) =>
      parsed(client, listReports, {
        problem,
        ...(cursor === undefined ? {} : { cursor }),
      }),
    report: (id) => parsed(client, getReport, { report: id }),
    ticket: (id) => parsed(client, ticketShow, { ticket: id }),
    fixes: (problem) => parsed(client, listProblemFixes, { problem }),
    verifications: (app, problem) =>
      parsed(client, listVerifications, { app, problem }),
    problems: (app) =>
      parsed(client, listProblems, { app, limit: PROBLEM_LIST_LIMIT }),
    releases: (app) =>
      parsed(client, releasesList, { app, limit: RELEASE_LIST_LIMIT }),
    release: (id) => parsed(client, releasesGet, { release: id }),
    invocation: (id) => parsed(client, invocationsGet, { invocation: id }),
    blob: (ref, maxBytes) =>
      options.blob === undefined
        ? defaultBlob(client, ref, maxBytes)
        : options.blob(ref, maxBytes),
  };
}
