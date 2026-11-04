// harness 하나를 ACP로 옮기는 adapter. 표만 두고 CLI별 구현은 harness마다 채운다.
import type { Clock } from "../../../../../base/clock.ts";
import type { IdSource } from "../../../../../base/id.ts";
import type { Result } from "../../../../../base/result.ts";
import type {
  AcpSessionHandle,
  ExtensionSpawn,
  GuiHarness,
} from "../../../../../protocol/extensions/mod.ts";
import { claudeAdapter } from "./claude.ts";
import { opencodeAdapter } from "./opencode.ts";

export type HarnessGuiAdapter = {
  /** CLI를 띄워 `session`에 ACP update를 내고 `session`의 입력을 CLI에 준다. 시작하지 못하면 오류다. */
  start(options: {
    cwd: string;
    /** 그 CLI 자신의 session id. */
    resume?: string;
    session: AcpSessionHandle;
    spawn: ExtensionSpawn;
    clock: Clock;
    ids: IdSource;
  }): Promise<Result<{ stop(): void }>>;
};

const unavailable =
  (harness: GuiHarness): HarnessGuiAdapter["start"] =>
  () =>
    Promise.resolve({
      ok: false,
      error: {
        code: "unavailable",
        message: `${harness} GUI is not available yet`,
      },
    });

// 다음 task들이 harness마다 `unavailable`을 구현으로 바꾼다.
export const HARNESS_GUI_ADAPTERS: Record<GuiHarness, HarnessGuiAdapter> = {
  claude: claudeAdapter,
  codex: { start: unavailable("codex") },
  opencode: opencodeAdapter,
};
