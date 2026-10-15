// 실제 디스크 여유 관측. Linux statfs의 동등 값이다.
// Deno 권한 모델에서 statfs는 sys 권한을, df subprocess는 run 권한을 요구한다.
// I/O worker spec은 run·sys를 열지 않으므로 product 경로는 관측 실패(unavailable)로 본다.

export type DiskQuota = {
  // 기준 위치의 실제 여유 바이트. 관측 실패는 unavailable로 본다.
  availableBytes(path: string): Promise<number | undefined>;
};

// statfs를 부르는 product adapter. sys 권한 없은 worker에서는 undefined다.
// 테스트는 fake quota를 넣거나 sys 권한으로 실측한다.
export function statfsBytes(path: string): Promise<number | undefined> {
  return (async () => {
    try {
      const { statfsSync } = await import("node:fs");
      const stat = statfsSync(path);
      const bytes = stat.bavail * stat.bsize;
      return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined;
    } catch {
      // sys 권한이 없은 child는 관측할 수 없다. 새 준비를 unavailable로 막는다.
      return undefined;
    }
  })();
}

export function systemQuota(): DiskQuota {
  return { availableBytes: statfsBytes };
}

// 관측을 막는 테스트·기본 adapter. 기본은 없음으로 본다.
export function unavailableQuota(): DiskQuota {
  return { availableBytes: () => Promise.resolve(undefined) };
}
