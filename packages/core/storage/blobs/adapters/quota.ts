// 실제 디스크 여유 관측. Linux statfs의 동등 값이다.
// 잴 수 없으면 0이 아니라 unavailable(undefined)로 답한다: 모르는 여유로 새 준비를 시작하지 않는다.

type DiskQuota = {
  // 기준 위치의 실제 여유 바이트. 관측 실패는 unavailable로 본다.
  availableBytes(path: string): Promise<number | undefined>;
};

// statfs를 부르는 product adapter. 테스트는 fake quota를 넣는다.
function statfsBytes(path: string): Promise<number | undefined> {
  return (async () => {
    try {
      const { statfsSync } = await import("node:fs");
      const stat = statfsSync(path);
      const bytes = stat.bavail * stat.bsize;
      return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined;
    } catch {
      // 잴 수 없는 파일 시스템이면 undefined. 부르는 쪽이 새 준비를 unavailable로 막는다.
      return undefined;
    }
  })();
}

export function systemQuota(): DiskQuota {
  return { availableBytes: statfsBytes };
}

// 관측을 막는 테스트·기본 adapter. 기본은 없음으로 본다.
