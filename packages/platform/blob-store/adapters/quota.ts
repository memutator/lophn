// 실제 디스크 여유 관측(platform/blob-store#R12). Linux statfs의 동등 값이다.

export type DiskQuota = {
  // 기준 위치의 실제 여유 바이트. 관측 실패는 unavailable로 본다.
  availableBytes(path: string): Promise<number | undefined>;
};

import { execFile } from "node:child_process";

function dfBytes(path: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile(
      "df",
      ["--output=avail", "-B1", path],
      { timeout: 2_000 },
      (error, stdout) => {
        if (error) return resolve(undefined);
        const lines = stdout.trim().split("\n");
        const last = lines[lines.length - 1];
        const parsed = Number.parseInt(last, 10);
        resolve(Number.isFinite(parsed) ? parsed : undefined);
      },
    );
  });
}

// df를 부르는 product adapter. 테스트는 fake quota를 넣는다.
export function systemQuota(): DiskQuota {
  return { availableBytes: dfBytes };
}

// 관측을 막는 테스트·기본 adapter. 기본은 없음으로 본다.
export function unavailableQuota(): DiskQuota {
  return { availableBytes: () => Promise.resolve(undefined) };
}

// 테스트가 여유를 고정할 때 쓴다.
export function createFakeQuota(available: number | undefined): DiskQuota {
  return { availableBytes: () => Promise.resolve(available) };
}
