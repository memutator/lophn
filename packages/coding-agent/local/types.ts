// `local` 명령의 모양이다. core를 부르지 않는 명령(`hook`, `harness *`)이라 `packages/cli`의 명령 표에 넣지 않고,
// binary 입구(`packages/cli/main.ts`)만 이것을 받아 끼운다. 이름·summary·description·input·positional은 표의 명령과
// 같은 칸이어서 parser와 help가 둘을 같게 다룬다(packages/cli는 이 package를 거꾸로 import하지 않으므로 모양만 맞춘다).
import type { z } from "zod";
import type { LophnError, Result } from "../../base/mod.ts";
import type { MemoryRoute, ReadRoute } from "../../protocol/base/route.ts";

// user token으로 core를 읽는 길이다(`harness sync-skills`). 자격이 없으면 오류다. binary가 끼운다.
export type LocalCore = {
  read<R extends ReadRoute | MemoryRoute>(
    route: R,
    input: unknown,
  ): Promise<Result<z.output<R["output"]>>>;
};

// local 명령이 쓰는 환경이다. main.ts가 채운다.
export type LocalContext = {
  env: { get(name: string): string | undefined };
  home: string;
  /** 명령을 친 폴더. */
  cwd: string;
  now(): string;
  stdin(): Promise<string>;
  /** `lophn hook <harness> lophn-gui -- <args...>`처럼 `--` 뒤에 그대로 넘겨진 인자들. */
  extraArgs?: readonly string[];
  core(): Result<LocalCore>;
};

export type LocalCommand = {
  // `hook`처럼 한 단어이거나 `harness.install`처럼 점 이름이다.
  name: string;
  summary: string;
  description: string;
  input: z.ZodType;
  positional?: readonly string[];
  effect: "read" | "write";
  run(
    input: Record<string, unknown>,
    ctx: LocalContext,
  ): Promise<Result<unknown, LophnError>>;
};
