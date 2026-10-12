// 테스트 전용: 감독하는 platform/io child를 같은 process 안의 실제 I/O worker로 바꿔 끼운다.
// 제품은 별도 process로 띄우고 거기서 OS keychain adapter를 만든다. 테스트는 그 adapter를 fake로
// 주입해야 사람의 실제 keychain에 닿지 않으므로, 같은 `createPlatformIo`를 같은 process에서
// 돌린다. core와 worker는 제품과 같은 길이 frame pipe로 이어진다(값은 byte chunk frame으로만
// 간다). 다른 kind(documents/worker 등)는 hello에 ready로 답하고 아무 일도 하지 않는 child다:
// 이 시험은 그 worker를 쓰지 않는다.
import {
  type ByteReader,
  type ByteWriter,
  type ChildSession,
  type Spawned,
  type SpawnRequest,
  startChild,
} from "../supervision/responsiveness/mod.ts";
import { createPlatformIo } from "../main/worker/io.ts";
import type { SecretPipe } from "../secrets/worker/pipe.ts";

type Queue = ByteReader & { push(bytes: Uint8Array): void; end(): void };

function queue(): Queue {
  const chunks: Uint8Array[] = [];
  let ended = false;
  const waiters: Array<() => void> = [];
  const wake = () => waiters.splice(0).forEach((resolve) => resolve());
  return {
    push(bytes) {
      chunks.push(bytes.slice());
      wake();
    },
    async read(buffer) {
      for (;;) {
        const head = chunks[0];
        if (head !== undefined) {
          const count = Math.min(buffer.length, head.length);
          buffer.set(head.subarray(0, count));
          if (count === head.length) chunks.shift();
          else chunks[0] = head.subarray(count);
          return count;
        }
        if (ended) return null;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
    end() {
      ended = true;
      wake();
    },
  };
}

type Streams = { stdin: ByteReader; stdout: ByteWriter; stderr: ByteWriter };

// 같은 process 안의 child를 core의 stdin·stdout pipe 모양(Spawned)으로 감싼다.
function bridge(
  start: (streams: Streams) => Promise<ChildSession>,
  pid: number,
  seen: Uint8Array[],
  // child를 crash시키는 함수를 넘긴다. stdin을 닫아 child가 EOF를 보고 끝나게 한다.
  onCrash?: (crash: () => void) => void,
): Spawned {
  const toChild = queue();
  onCrash?.(() => toChild.end());
  const fromChild = queue();
  const log = queue();
  const exited = (async () => {
    const session = await start({
      stdin: toChild,
      stdout: {
        write(bytes) {
          fromChild.push(bytes);
          return Promise.resolve(bytes.length);
        },
      },
      stderr: {
        write(bytes) {
          log.push(bytes);
          return Promise.resolve(bytes.length);
        },
      },
    });
    await session.run();
    fromChild.end();
    return 0;
  })();
  return {
    pid,
    stdin: {
      write(bytes) {
        seen.push(bytes.slice());
        toChild.push(bytes);
        return Promise.resolve();
      },
      close() {
        toChild.end();
        return Promise.resolve();
      },
    },
    stdout: {
      read: (buffer) => fromChild.read(buffer),
      cancel: () => fromChild.end(),
      bufferedBytes: 0,
    },
    stderr: {
      read: (buffer) => log.read(buffer),
      cancel: () => log.end(),
      bufferedBytes: 0,
    },
    exited,
    async terminate() {
      toChild.end();
      await exited.catch(() => 0);
      return true;
    },
  };
}

export type InProcessIo = {
  spawn(request: SpawnRequest): Spawned;
  // 감독이 띄운 요청(실행 파일·argv·환경)이다. 값이 argv·env에 가지 않았음을 본다.
  readonly requests: readonly SpawnRequest[];
  // core가 I/O worker의 stdin에 쓴 원 바이트다(frame 그대로). 값이 JSON 제어 frame에 없음을 본다.
  readonly stdin: readonly Uint8Array[];
  // 그 kind의 지금 child를 crash시킨다(stdin EOF). 감독이 재기동 경로로 다룬다. child가 없으면 false다.
  crash(kind: string): boolean;
  // 그 kind의 child를 띄운 횟수다.
  spawned(kind: string): number;
  // core가 그 kind의 child stdin에 쓴 횟수다(hello 포함). I/O worker가 아닌 kind만 센다.
  writes(kind: string): number;
};

export function inProcessIo(options: {
  root: string;
  secrets?: SecretPipe;
  // 이 kind들은 실제 worker 대신 요청에 답하지 않는 child로 띄운다(요청이 child에 묶인 채 남는 모양).
  stall?: readonly string[];
}): InProcessIo {
  const crashes = new Map<string, () => void>();
  const counts = new Map<string, number>();
  const written = new Map<string, Uint8Array[]>();
  const requests: SpawnRequest[] = [];
  const ioBytes: Uint8Array[] = [];
  return {
    requests,
    stdin: ioBytes,
    crash(kind) {
      const crash = crashes.get(kind);
      if (crash === undefined) return false;
      crashes.delete(kind);
      crash();
      return true;
    },
    spawned: (kind) => counts.get(kind) ?? 0,
    writes: (kind) => written.get(kind)?.length ?? 0,
    spawn(request) {
      requests.push(request);
      const pid = 4_000_000 + requests.length;
      const kind = request.env["LOPHN_WORKER_KIND"] ?? "";
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      const onCrash = (crash: () => void) => crashes.set(kind, crash);
      const seen = written.get(kind) ?? [];
      written.set(kind, seen);
      if (
        kind === "platform/io" && !(options.stall ?? []).includes(kind)
      ) {
        return bridge(
          (streams) =>
            createPlatformIo({
              root: options.root,
              catalog: {
                components: ["platform/core", "platform/io"],
                locations: {},
              },
              currentAuthority: () => undefined,
              secrets: options.secrets,
              streams,
            }),
          pid,
          ioBytes,
          onCrash,
        );
      }
      return bridge(
        (streams) => {
          const idle: { session?: ChildSession } = {};
          idle.session = startChild(streams, {
            onHello: () => idle.session!.send({ type: "ready" }),
            onStop: () => idle.session!.send({ type: "stopped" }),
          });
          return Promise.resolve(idle.session);
        },
        pid,
        seen,
        onCrash,
      );
    },
  };
}
