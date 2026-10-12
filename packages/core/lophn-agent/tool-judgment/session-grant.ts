import { err, ok, type Result } from "../../../base/mod.ts";
import {
  sessionRead,
  toolCallList,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  type ApprovalRequest,
  approvalsList,
} from "../../../protocol/approvals/mod.ts";
import { eventsList } from "../../../protocol/events/mod.ts";
import { type CoreCall, post } from "./core-call.ts";
import { type BasisSnapshot, sameToolBasis } from "./model.ts";

// session 허락 근거 찾기(R13, R14, platform/approvals#R19, R20). 별도 허락 표는 없다. 허락 session이
// 이 session인 granted request를 조회해 계산한다. 읽지 못한 사실이 있으면 낮추지 않고 묻는다.

export type SessionGrantQuery = {
  // 호출한 run이 속한 session.
  session: string;
  // 지금 호출의 소유 concern과 동작(basis.operation). 허락의 action과 같아야 한다.
  concern: string;
  // 지금 호출의 판정 기준. 허락 때 기록한 기준과 tool·계약·연결·권한 판이 같아야 한다.
  basis: BasisSnapshot;
};

// session이 이 두 사건을 겪으면 그 앞의 허락은 사라진다. 다시 열려도(archive를 풀어도) 되살아나지 않는다.
const ENDED_EVENTS = ["SessionArchived", "SessionClosed"];
const LIST_LIMIT = 100;
const MAX_PAGES = 20;

// 허락 뒤에 session이 archive되거나 닫힌 사건의 seq 목록.
async function endings(
  core: CoreCall,
  session: string,
  after: bigint,
): Promise<Result<bigint[]>> {
  const found: bigint[] = [];
  let cursor = after;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const read = await post(core, eventsList, {
      after_seq: cursor.toString(),
      subjects: [session],
      types: ENDED_EVENTS,
    });
    if (!read.ok) return read;
    for (const event of read.value.events) found.push(BigInt(event.seq));
    const scanned = BigInt(read.value.scanned_through_seq);
    if (scanned >= BigInt(read.value.head_seq)) return ok(found);
    if (scanned <= cursor) break;
    cursor = scanned;
  }
  return err({
    code: "unavailable",
    message: "session events are not readable",
  });
}

// 그 request를 만든 호출의 판정 기준이다. request는 호출의 ToolDecision.approval이 가리키므로 그
// request의 run에서 그 호출을 찾는다.
async function recordedBasis(
  core: CoreCall,
  request: ApprovalRequest,
): Promise<unknown> {
  if (request.run === null) return undefined;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const read = await post(core, toolCallList, {
      run: request.run,
      limit: LIST_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!read.ok) return undefined;
    for (const call of read.value.tool_calls) {
      if (call.decision?.approval === request.id) {
        return call.decision.comparison_basis;
      }
    }
    if (read.value.next_cursor === null) return undefined;
    cursor = read.value.next_cursor;
  }
  return undefined;
}

// 낮출 근거가 되는 허락의 request ID. 없으면 undefined이고 평소대로 묻는다.
export async function findSessionGrant(
  core: CoreCall,
  query: SessionGrantQuery,
): Promise<string | undefined> {
  const read = await post(core, sessionRead, { session: query.session });
  if (!read.ok) return undefined;
  const { state, archived } = read.value.session;
  if (state !== "open" || archived) return undefined;

  const listed = await post(core, approvalsList, {
    status: "granted",
    grant_session: query.session,
    limit: LIST_LIMIT,
  });
  if (!listed.ok) return undefined;
  const candidates = listed.value.requests.filter((request) =>
    request.grant_scope === "session" &&
    request.grant_session === query.session &&
    request.closed_seq !== null &&
    request.action.concern === query.concern &&
    request.action.command === query.basis.operation
  );
  if (candidates.length === 0) return undefined;

  const earliest = candidates.reduce<bigint>((least, request) => {
    const seq = BigInt(request.closed_seq!);
    return seq < least ? seq : least;
  }, BigInt(candidates[0].closed_seq!));
  const ended = await endings(core, query.session, earliest);
  if (!ended.ok) return undefined;

  for (const request of candidates) {
    const grantedAt = BigInt(request.closed_seq!);
    if (ended.value.some((seq) => seq > grantedAt)) continue;
    const basis = await recordedBasis(core, request);
    if (sameToolBasis(basis, query.basis)) return request.id;
  }
  return undefined;
}
