import type { Result } from "../../../base/mod.ts";

// core 읽기와 command는 주입한 호출로만 한다. machine 자격의 loopback이 보통이다.
export type CoreCall = (
  path: string,
  body: unknown,
) => Promise<Result<unknown>>;
