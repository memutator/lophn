// 개발과 test가 Expo Push 자리에 쓰는 fake push server. `/--/api/v2/push/send`와
// `/--/api/v2/push/getReceipts` 둘만 말한다. 실제 Expo endpoint를 개발과 test에서 부르지 않게 하는 경계다.
// ticket id는 순서대로(`ticket-1`...), 영수증은 기본 ok이고 `deadToken`으로 정한 token만 DeviceNotRegistered다.

import { serve } from "../../../packages/core/server/serve.ts";

const SEND = "/--/api/v2/push/send";
const RECEIPTS = "/--/api/v2/push/getReceipts";

/** 다음 send 하나에 줄 응답: ticket error DeviceNotRegistered, HTTP 429, HTTP 500. */
export type FakePushFailure = "DeviceNotRegistered" | 429 | 500;

export type FakePushHandler = {
  handle(request: Request): Promise<Response>;
  /** 받은 send 요청 본문 전체(core가 보낸 그대로). */
  journal: unknown[];
  /** 받은 getReceipts 요청 본문. */
  receiptJournal: unknown[];
  /** 앞으로 오는 send 요청 하나마다 차례로 이 응답을 준다. */
  failNext(...failures: FakePushFailure[]): void;
  /** 이 token으로 간 ticket의 영수증을 DeviceNotRegistered로 만든다. */
  deadToken(token: string): void;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createFakePushHandler(
  options: { onMessage?: (message: unknown) => void } = {},
): FakePushHandler {
  const journal: unknown[] = [];
  const receiptJournal: unknown[] = [];
  const failures: FakePushFailure[] = [];
  const dead = new Set<string>();
  const tokenOf = new Map<string, string>();
  let issued = 0;

  async function handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || (path !== SEND && path !== RECEIPTS)) {
      return json(400, {
        errors: [{ message: `unexpected ${request.method} ${path}` }],
      });
    }
    const body = (await request.json()) as Record<string, unknown>;
    if (path === RECEIPTS) {
      receiptJournal.push(body);
      const data: Record<string, unknown> = {};
      for (const id of (body.ids as string[]) ?? []) {
        const token = tokenOf.get(id);
        if (token === undefined) continue;
        data[id] = dead.has(token)
          ? {
              status: "error",
              message: "The device is no longer registered.",
              details: { error: "DeviceNotRegistered" },
            }
          : { status: "ok" };
      }
      return json(200, { data });
    }
    journal.push(body);
    options.onMessage?.(body);
    const failure = failures.shift();
    if (failure === 429 || failure === 500) {
      return json(failure, { errors: [{ message: `fake ${failure}` }] });
    }
    if (failure === "DeviceNotRegistered") {
      return json(200, {
        data: {
          status: "error",
          message: "The device is no longer registered.",
          details: { error: "DeviceNotRegistered" },
        },
      });
    }
    issued += 1;
    const id = `ticket-${issued}`;
    tokenOf.set(id, String(body.to));
    return json(200, { data: { status: "ok", id } });
  }

  return {
    handle,
    journal,
    receiptJournal,
    failNext: (...next) => void failures.push(...next),
    deadToken: (token) => void dead.add(token),
  };
}

export type FakePush = FakePushHandler & {
  /** core의 `remote.push`에 넣는 send 주소. */
  url: string;
  close(): Promise<void>;
};

export async function startFakePush(options: {
  port: number;
  onMessage?: (message: unknown) => void;
}): Promise<FakePush> {
  const fake = createFakePushHandler({ onMessage: options.onMessage });
  const server = await serve(
    { hostname: "127.0.0.1", port: options.port },
    fake.handle,
  );
  const port = server.addr.transport === "tcp" ? server.addr.port : 0;
  return Object.assign(fake, {
    url: `http://127.0.0.1:${port}${SEND}`,
    close: () => server.shutdown(),
  });
}
