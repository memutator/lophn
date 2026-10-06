// core가 documents coordinator에 관측 근거를 보낸다(documents plan Q15). coordinator는
// machine으로 tracking 규칙과 경로→문서 연결을 읽지 않는다: core가 소유자로 ledger
// snapshot에서 읽어 core→coordinator 요청 envelope(`documents.observation_basis`)로
// 넘기고, 바뀐 것만 같은 통로로 다시 보낸다. 새 HTTP route·credential 정책은 없다.
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  chunkObservationBasis,
  type ObservationBasisPayload,
  parseObservationBasis,
} from "../../packages/documents/file-tracking/mod.ts";

// 근거를 읽는 한 걸음. roots는 한 번에, links는 경로 page로 온다.
export type BasisRead = (
  input: { part: "roots" | "links"; after?: string },
) => Promise<Result<unknown>>;

export type BasisSyncDeps = {
  read: BasisRead;
  // chunk 하나를 coordinator에 보낸다. 닿지 못하면 err다.
  push(chunk: unknown): Promise<Result<unknown>>;
  // 읽기·보내기가 실패했을 때 다시 확인하기까지의 대기. 성공이면 timer를 두지 않는다.
  retryMs: number;
};

export type BasisSync = {
  // 한 번 맞춘다. event 구독자(machine:documents-feed)와 시험이 같은 함수를 부른다.
  check(): Promise<void>;
  // coordinator가 새로 떴다. 다음 확인이 근거 전체를 다시 보낸다.
  invalidate(): void;
  stop(): void;
};

// 읽기 도중 ledger가 바뀌어 page의 기준이 어긋나면 처음부터 다시 읽는다. 쓰기가 끊이지
// 않아도 무한히 돌지 않도록 횟수를 둔다. 넘으면 이번 확인은 건너뛰고 다음에 다시 한다.
const READ_ATTEMPTS = 5;

type Page = { as_of_seq: string; next_cursor: string | null };

function pageOf(value: unknown): Result<Page & Record<string, unknown>> {
  const page = value as Partial<Page> & Record<string, unknown>;
  if (
    typeof page !== "object" || page === null ||
    typeof page.as_of_seq !== "string" ||
    (page.next_cursor !== null && typeof page.next_cursor !== "string")
  ) {
    return err({ code: "internal", message: "basis read is malformed" });
  }
  return ok(page as Page & Record<string, unknown>);
}

// roots와 links를 같은 snapshot 기준(as_of_seq)으로 읽는다.
export async function readObservationBasis(
  read: BasisRead,
  seen?: string,
): Promise<
  Result<
    { payload: ObservationBasisPayload; as_of_seq: string } | {
      unchanged: true;
    }
  >
> {
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
    const first = await read({ part: "roots" });
    if (!first.ok) return first;
    const roots = pageOf(first.value);
    if (!roots.ok) return roots;
    // ledger가 그대로면 근거도 그대로다. 연결 page를 다시 읽지 않는다.
    if (seen !== undefined && roots.value.as_of_seq === seen) {
      return ok({ unchanged: true });
    }
    const links: unknown[] = [];
    let after: string | undefined;
    let consistent = true;
    do {
      const next = await read({
        part: "links",
        ...(after === undefined ? {} : { after }),
      });
      if (!next.ok) return next;
      const page = pageOf(next.value);
      if (!page.ok) return page;
      if (page.value.as_of_seq !== roots.value.as_of_seq) {
        consistent = false;
        break;
      }
      const rows = page.value["links"];
      if (!Array.isArray(rows)) {
        return err({ code: "internal", message: "basis read is malformed" });
      }
      links.push(...rows);
      after = page.value.next_cursor ?? undefined;
    } while (after !== undefined);
    if (!consistent) continue;
    const payload = parseObservationBasis({
      roots: roots.value["roots"],
      folders: roots.value["folders"],
      links,
    });
    if (!payload.ok) return payload;
    return ok({ payload: payload.value, as_of_seq: roots.value.as_of_seq });
  }
  return err({
    code: "unavailable",
    message: "ledger가 계속 바뀌어 관측 근거를 읽지 못했다",
  });
}

// 근거는 주기로 읽지 않는다. 구독자가 documents event로 깨우고 (다시) 구독할 때 한 번 맞춘다
// (documents plan Q17). 읽기·보내기가 실패하면 retryMs 뒤 다시 한다.
export function watchObservationBasis(deps: BasisSyncDeps): BasisSync {
  // 마지막으로 coordinator가 받은 근거와 그때의 snapshot. 보내기 실패는 둘 다 버려
  // 다음 확인이 전체를 다시 보낸다.
  let sent: ObservationBasisPayload | undefined;
  let sentSeq: string | undefined;
  let stopped = false;
  let running: Promise<void> | undefined;
  let again = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  function retryLater() {
    if (stopped || retry !== undefined) return;
    retry = setTimeout(() => {
      retry = undefined;
      void check();
    }, deps.retryMs);
  }

  async function once(): Promise<void> {
    const read = await readObservationBasis(deps.read, sentSeq);
    if (stopped) return;
    if (!read.ok) return retryLater();
    if ("unchanged" in read.value) return;
    const { payload, as_of_seq } = read.value;
    const chunks = chunkObservationBasis(sent, payload);
    for (const chunk of chunks) {
      const pushed = await deps.push(chunk);
      if (!pushed.ok) {
        // coordinator가 일부만 받았을 수 있다. 다음에는 처음부터 보낸다.
        sent = undefined;
        sentSeq = undefined;
        return retryLater();
      }
    }
    sent = payload;
    sentSeq = as_of_seq;
  }

  function check(): Promise<void> {
    // 겹친 확인은 하나로 합친다: 보내는 도중에 또 보내지 않는다. 다만 도는 중에 온 신호는
    // 이미 읽은 값 뒤의 변화일 수 있어서, 끝난 뒤 한 번 더 확인한다.
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await once();
      } while (again && !stopped);
    })().finally(() => {
      running = undefined;
    });
    return running;
  }

  return {
    check,
    invalidate() {
      sent = undefined;
      sentSeq = undefined;
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
      retry = undefined;
    },
  };
}
