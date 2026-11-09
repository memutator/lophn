import type { LogRecord } from "../../base/telemetry/mod.ts";
import { DIAGNOSTICS_WRITE_MAX_PENDING_BYTES } from "../../protocol/diagnostics/mod.ts";

// core log를 `<data root>/logs/core-N.jsonl`에 남기는 비동기 기록기. record를 JSON 한 줄로 queue에 두고
// 모아서 쓴다(file 쓰기마다 안전 점검이 있어 줄마다 쓰지 않는다). queue가 byte 상한을 넘으면
// 그 record를 버리고 센다. 쓰기 실패도 버린 것으로 센다. 기록이 core 일을 막거나 늦추지 않는다.
// file은 data root를 안 뒤에 attach로 붙는다. 그 전 record는 queue에 둔다.

const BATCH_BYTES = 64 * 1024;

export type LogRecorder = {
  push(record: LogRecord): void;
  attach(files: { write(bytes: Uint8Array): Promise<void> }): void;
  flush(): Promise<void>;
  readonly dropped: number;
};

export function createLogRecorder(): LogRecorder {
  const encoder = new TextEncoder();
  const queue: Uint8Array[] = [];
  let pendingBytes = 0;
  let dropped = 0;
  let reported = 0;
  let files: { write(bytes: Uint8Array): Promise<void> } | undefined;
  let draining: Promise<void> | undefined;

  const take = (): Uint8Array => {
    let size = 0;
    let count = 0;
    while (count < queue.length && (count === 0 || size < BATCH_BYTES)) {
      size += queue[count++].length;
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const part of queue.splice(0, count)) {
      out.set(part, at);
      at += part.length;
    }
    pendingBytes -= size;
    return out;
  };

  async function drain(): Promise<void> {
    while (queue.length > 0 && files !== undefined) {
      const bytes = take();
      try {
        await files.write(bytes);
      } catch {
        dropped += 1;
      }
    }
  }

  function start(): void {
    if (draining !== undefined || files === undefined) return;
    draining = Promise.resolve()
      .then(drain)
      .finally(() => {
        draining = undefined;
        if (queue.length > 0) start();
      });
  }

  function enqueue(line: string): boolean {
    const bytes = encoder.encode(`${line}\n`);
    if (pendingBytes + bytes.length > DIAGNOSTICS_WRITE_MAX_PENDING_BYTES) {
      dropped += 1;
      return false;
    }
    queue.push(bytes);
    pendingBytes += bytes.length;
    return true;
  }

  return {
    push(record) {
      // 버린 것이 있으면 다음 record 앞에 한 줄로 알린다. 몇 개를 잃었는지 읽을 수 있게 한다.
      if (dropped > reported) {
        const lost = dropped - reported;
        const noted = enqueue(
          JSON.stringify({
            timestamp: record.timestamp,
            level: "warn",
            service_name: record.service_name,
            component: "log",
            event: "records_dropped",
            fields: { count: lost },
          }),
        );
        // enqueue가 실패하면 dropped를 또 올리므로 그만큼은 알림이 아니라 새 손실이다.
        if (noted) reported += lost;
      }
      if (enqueue(JSON.stringify(record))) start();
    },
    attach(next) {
      files = next;
      start();
    },
    async flush() {
      while (draining !== undefined) await draining;
    },
    get dropped() {
      return dropped;
    },
  };
}
