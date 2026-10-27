// trial 기록을 읽는 작은 함수. check들이 같이 쓴다.
import type { CallReply } from "../../../packages/protocol/lophn-agent/mod.ts";
import type {
  CollectedToolCall,
  Participant,
  SentCall,
  TrialRecord,
} from "../types.ts";

// 모든 칸이 맞는 call만 센다.
export type CallWhere = {
  target?: Participant;
  notTarget?: Participant;
  reply?: CallReply;
};

// 재시도에 밀린 행(다른 행이 retry_of로 가리키는 행)을 뺀 tool call. ev-collect에도 같은 규칙이 있고 공유하지 않는다.
export function effectiveToolCalls(trial: TrialRecord): CollectedToolCall[] {
  const all = trial.sessions.flatMap((s) => s.tool_calls);
  const superseded = new Set(all.map((c) => c.call.retry_of));
  return all.filter((c) => !superseded.has(c.call.id));
}

export function toolCallsOf(
  trial: TrialRecord,
  tool?: string,
): CollectedToolCall[] {
  return effectiveToolCalls(trial).filter(
    (c) => tool === undefined || c.call.tool === tool,
  );
}

// tool_call id는 ULID라 id 순이 시간 순이다.
export function sentCalls(trial: TrialRecord, where?: CallWhere): SentCall[] {
  return trial.sessions
    .flatMap((s) => s.sent_calls)
    .sort((a, b) =>
      a.tool_call < b.tool_call ? -1 : a.tool_call > b.tool_call ? 1 : 0,
    )
    .filter((c) => where === undefined || matchWhere(c, where));
}

export function matchWhere(c: SentCall, where: CallWhere): boolean {
  return (
    (where.target === undefined || matchTarget(c, where.target)) &&
    (where.notTarget === undefined || !matchTarget(c, where.notTarget)) &&
    (where.reply === undefined || c.reply === where.reply)
  );
}

type NameForm = { role: string; place?: unknown; name?: unknown };

function nameForm(to: unknown): NameForm | null {
  return typeof to === "object" &&
    to !== null &&
    typeof (to as { role?: unknown }).role === "string"
    ? (to as NameForm)
    : null;
}

function placeKindName(place: unknown): [string, string] | null {
  const p = place as { app?: string; project?: string } | undefined | null;
  if (p?.app !== undefined) return ["app", p.app];
  if (p?.project !== undefined) return ["project", p.project];
  return null;
}

export function matchTarget(c: SentCall, t: Participant): boolean {
  const to = nameForm(c.to);
  if (t.name !== undefined && (to === null || to.name !== t.name)) return false;
  if (c.receiver !== null) {
    if (c.receiver.role !== t.role) return false;
    if (t.place === undefined) return true;
    const [kind, name] = placeKindName(t.place)!;
    return c.receiver_place?.kind === kind && c.receiver_place.name === name;
  }
  if (to === null || to.role !== t.role) return false;
  if (t.place === undefined) return true;
  const want = placeKindName(t.place)!;
  const got = placeKindName(to.place);
  return got !== null && got[0] === want[0] && got[1] === want[1];
}
