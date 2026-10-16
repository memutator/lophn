// 확정 메시지 본문 읽기(ReadMessageBody). 사람 말·lophn 답·machine 사실·다른 창이 보낸
// 말 모두 같은 read로 읽는다. 확정 메시지의 본문은 바뀌지 않아 창 메모리(DraftStore)에
// 한 번 읽은 값을 둔다. 결과를 모르는 실패만 다음 박자에 다시 읽는다.
import type { BodyPart, SourceResult } from "./agent-tab-source.ts";
import type { DraftStore } from "./drafts.ts";

/** 본문을 읽는 통로. 대화 화면의 어느 source든 이것을 가진다. */
interface BodySource {
  body(message: string): Promise<SourceResult<readonly BodyPart[]>>;
}

/** 한 번에 읽는 본문 수. 긴 세션도 core read queue를 한꺼번에 채우지 않는다. */
const BODY_READS_AT_ONCE = 4;

// 다시 읽어도 같은 답인 오류. not_found는 없거나 범위 밖인 메시지다. 그 밖(unavailable,
// internal, 통로 실패)은 본문 blob을 잠깐 못 읽은 것이라 다시 읽는다.
const SETTLED = new Set([
  "not_found",
  "forbidden",
  "unauthorized",
  "invalid_input",
]);

// 다시 읽는 중인 실패. 실패 표시를 그대로 두고 같은 본문을 겹쳐 읽지 않는다.
const retrying = new WeakMap<DraftStore, Set<string>>();

function inFlight(drafts: DraftStore): Set<string> {
  let found = retrying.get(drafts);
  if (found === undefined) {
    found = new Set();
    retrying.set(drafts, found);
  }
  return found;
}

/** 이 메시지의 본문을 지금 읽어야 하는지. */
function needsBody(drafts: DraftStore, message: string): boolean {
  const state = drafts.body(message);
  if (state === undefined) return true;
  return state.state === "failed" && !SETTLED.has(state.code) &&
    !inFlight(drafts).has(message);
}

/** 아직 읽지 않았거나 다시 읽을 본문을 읽어 창 메모리에 둔다. */
export async function loadBodies(
  source: BodySource,
  drafts: DraftStore,
  messages: readonly { readonly id: string }[],
): Promise<void> {
  const wanted = messages
    .map((message) => message.id)
    .filter((message) => needsBody(drafts, message));
  const pending = inFlight(drafts);
  for (const message of wanted) {
    if (drafts.body(message) === undefined) {
      drafts.setBody(message, { state: "loading" });
    } else pending.add(message);
  }
  let next = 0;
  const reader = async () => {
    while (next < wanted.length) {
      const message = wanted[next]!;
      next += 1;
      const read = await source.body(message);
      pending.delete(message);
      drafts.setBody(
        message,
        read.ok
          ? { state: "ready", parts: read.value }
          : { state: "failed", code: read.code },
      );
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(BODY_READS_AT_ONCE, wanted.length) },
      reader,
    ),
  );
}
