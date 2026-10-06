// documents coordinator를 감독이 포기한 뒤 core가 다시 띄우는 일. 감독은 crash마다 최대 3회
// 다시 띄우고(1·2·4초) 그래도 끝나면 그 kind를 unavailable로 둔다. 그 뒤에는 이 모듈이
// backoff(250ms부터 두 배, 최대 8초)로 한 번에 하나씩 다시 띄운다. 다시 띄우는 횟수는 core 시작마다
// 한도(DOCUMENTS_RESPAWN_LIMIT)로 막는다: coordinator가 시작하자마자 죽는 결함이 있으면 끝없이
// 도는 대신 unavailable로 남고 한 번만 알린다(reader pool의 respawn과 같은 규칙이다).

export const DOCUMENTS_RESPAWN_LIMIT = 6;
export const DOCUMENTS_RESPAWN_BASE_MS = 250;
export const DOCUMENTS_RESPAWN_MAX_MS = 8_000;

export type DocumentsRespawnDeps = {
  // 새 child를 띄운다. 띄워서 ready가 되면 true다. 던지면 실패로 센다.
  respawn(): Promise<boolean>;
  // 한도를 넘어 더는 다시 띄우지 않는다. 한 번만 부른다.
  onExhausted?(reason: string): void;
  limit?: number;
  baseMs?: number;
  maxMs?: number;
  // 시험이 대기를 바꿔 끼울 때만 쓴다.
  sleep?(ms: number): Promise<void>;
};

export type DocumentsRespawner = {
  // 감독이 포기했다. 이미 다시 띄우는 중이면 아무것도 하지 않는다.
  giveUp(reason: string): void;
  // core 종료. 대기 중인 다시 띄움은 하지 않는다.
  stop(): void;
  // 지금까지 다시 띄우려 한 횟수.
  readonly used: number;
};

export function createDocumentsRespawner(
  deps: DocumentsRespawnDeps,
): DocumentsRespawner {
  const limit = deps.limit ?? DOCUMENTS_RESPAWN_LIMIT;
  const baseMs = deps.baseMs ?? DOCUMENTS_RESPAWN_BASE_MS;
  const maxMs = deps.maxMs ?? DOCUMENTS_RESPAWN_MAX_MS;
  // 기본 대기는 stop이 바로 깨운다: 종료한 core가 timer를 남기지 않는다.
  let wake: (() => void) | undefined;
  const sleep = deps.sleep ?? ((ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = undefined;
        resolve();
      }, ms);
      wake = () => {
        clearTimeout(timer);
        wake = undefined;
        resolve();
      };
    }));
  let used = 0;
  let stopped = false;
  let running = false;
  let announced = false;

  async function loop(reason: string) {
    while (!stopped) {
      if (used >= limit) {
        if (!announced) {
          announced = true;
          try {
            deps.onExhausted?.(reason);
          } catch { /* 안전 실패: 알림 예외가 core를 막지 않는다 */ }
        }
        return;
      }
      await sleep(Math.min(maxMs, baseMs * 2 ** used));
      if (stopped) return;
      used += 1;
      const ok = await deps.respawn().catch(() => false);
      if (ok) return;
    }
  }

  return {
    giveUp(reason) {
      if (stopped || running) return;
      running = true;
      void loop(reason).finally(() => {
        running = false;
      });
    },
    stop() {
      stopped = true;
      wake?.();
    },
    get used() {
      return used;
    },
  };
}
