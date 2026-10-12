// 이 run이 실제로 읽은 고정 판의 기록이다. 본문을 받은 읽기만 센다. 재시작하면 비어 새로 읽어야
// 한다(fail closed). 문서 묶음이 쓰고(저장 기준·근거), 시각 묶음이 출처 검증에 읽는다.
const READ_LOG_CAP = 500;

export type ReadLog = {
  remember(run: string, document: string, version: string): void;
  has(run: string, document: string, version: string): boolean;
};

function keyOf(document: string, version: string): string {
  return `${document}@${version}`;
}

export function createReadLog(): ReadLog {
  const logs = new Map<string, Set<string>>();
  return {
    remember(run, document, version) {
      let log = logs.get(run);
      if (log === undefined) {
        log = new Set();
        logs.set(run, log);
      }
      if (log.size >= READ_LOG_CAP) {
        const oldest = log.values().next().value;
        if (oldest !== undefined) log.delete(oldest);
      }
      log.add(keyOf(document, version));
    },
    has(run, document, version) {
      return logs.get(run)?.has(keyOf(document, version)) === true;
    },
  };
}
