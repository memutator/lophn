// core 안 extension host가 core의 다른 쪽에 내는 것이다. registry(manifest 읽기, 켜진 것만 activate), CLI를 띄우는 spawner, ACP
// handle이 이 뒤에 있다. 설정 route handler, extension tool 호출, coding agent의 GUI 전환이 이 port로 닿는다.
import type { Result } from "../../base/mod.ts";
import type { AcpTabHandlers } from "../../protocol/extensions/acp-session.ts";
import type {
  ExtensionToolContent,
  ExtensionToolCall,
} from "../../protocol/extensions/manifest.ts";
import type { ExtensionView } from "../../protocol/extensions/routes.ts";
import type { PublishedExtension } from "../../protocol/lophn-agent/extension-tools.ts";

export type ExtensionHost = {
  list(): Promise<ExtensionView[]>;
  install(id: string): Promise<Result<void>>;
  remove(id: string): Promise<Result<void>>;
  // `ext.<id>.<name>` command.
  run(command: string): Promise<Result<void>>;
  // 켜진 extension이 `ctx.tools.handle`로 둔 handler를 부른다. caller는 부른 agent session과 그 자리이고, credential은 그 호출에만
  // 빌려 준 agent 자격이다(handler의 `core`가 이것으로 부른다). 없으면 not_found다.
  callTool(
    extension: string,
    tool: string,
    input: unknown,
    caller: Omit<ExtensionToolCall, "core"> & { credential: string },
  ): Promise<Result<ExtensionToolContent[]>>;
  // 판이 맞는 manifest의 tool 전부(켜진 것과 꺼진 것). 켜진 것만 고르는 것은 부르는 쪽이 설정으로 한다.
  catalog(): readonly PublishedExtension[];
  // 켜진 harness-gui가 `onTab`으로 건 탭 GUI·TUI 전환. 꺼져 있으면 null이다.
  tabHandlers(): AcpTabHandlers | null;
  // 설정(`extensions.<id>.enabled`)과 manifest를 다시 읽어 켜고 끈다. 겹쳐 불러도 차례로 돈다.
  sync(): Promise<void>;
  // 켜진 것을 모두 deactivate하고 띄운 CLI를 끝낸다.
  stop(): Promise<void>;
};
