// 앱 프로세스의 host가 SDK(@lophn/cap-schedule의 registerScreenContext·registerAnnotationTarget)에
// 설치하는 port다. SDK는 packages/core/apps를 import하지 않으므로 같은 symbol과 모양으로 맞춘다
// (packages/sdk/cap-schedule/screen-context.ts). 민감 path와 선언은 앱 코드가 아니라 release에
// 고정된 blueprint에서 오고, 제거·요약 규칙은 bundle의 플랫폼 진입 파일이라 앱이 바꾸지 못한다.
// release bundle에 들어가는 플랫폼 진입 파일이라 의존성이 없다.
import { prepareScreenContext } from "./redaction.ts";
import type { PreparedContext, PrepareInput } from "./redaction.ts";
import { parseReadInput, parseWriteInput } from "./schema.ts";
import type { Parsed, ReadInput, WriteInput } from "./schema.ts";

export const SCREEN_CONTEXT_PORT = Symbol.for("lophn.screen-context");

// blueprint.agent_context[]의 한 항목(AgentContextDeclaration)과 같은 모양이다.
export type DeclaredContext = {
  screen: string;
  read_command: string;
  sensitive_paths: readonly string[];
  annotation_targets: readonly {
    key: string;
    label: string;
    write_command: string;
  }[];
};

export type ScreenContextHost = {
  declaration(screen: string): DeclaredContext | undefined;
  // 이 프로세스가 연 view session. 닫혔거나 모르는 session은 없다.
  view(viewSession: string): { screen: string } | undefined;
  parseRead(raw: unknown): Parsed<ReadInput>;
  parseWrite(raw: unknown): Parsed<WriteInput>;
  prepare(input: PrepareInput): PreparedContext;
};

export type ScreenContextSource = {
  declarations(): readonly DeclaredContext[];
  view(viewSession: string): { screen: string } | undefined;
};

export function createScreenContextHost(
  source: ScreenContextSource,
): ScreenContextHost {
  return {
    declaration: (screen) =>
      source.declarations().find((item) => item.screen === screen),
    view: (viewSession) => source.view(viewSession),
    parseRead: parseReadInput,
    parseWrite: parseWriteInput,
    prepare: prepareScreenContext,
  };
}

// 같은 프로세스에서 시작을 다시 하면(시험) 마지막 시작의 선언·view를 쓴다.
export function installScreenContextHost(
  source: ScreenContextSource,
): ScreenContextHost {
  const host = createScreenContextHost(source);
  (globalThis as Record<symbol, unknown>)[SCREEN_CONTEXT_PORT] = host;
  return host;
}
