// 창 하나의 command 표. 기능이 자기 command를 id로 올리고, 부르는 쪽(단축키, main이 보낸 command,
// 나중의 팔레트·menu)은 id만 안다. React를 모른다.
import { err, internalError, ok, type Result } from "../../../base/mod.ts";

export interface Disposable {
  dispose(): void;
}

/** arg는 부르는 쪽이 준다(tab.nth의 번호). 모양은 command 주인이 정한다. */
export type CommandHandler = (arg: unknown) => void;

export interface CommandOptions {
  /** false면 이 handler는 없는 것처럼 본다. 단축키는 키를 삼키지 않고 넘긴다. */
  readonly when?: () => boolean;
}

export interface CommandRegistry {
  /**
   * 같은 id를 다시 올리면 나중 것이 이긴다. 그것을 dispose하면 앞의 것이 다시 산다.
   * 화면이 다시 mount될 때 앞 주인의 정리와 새 주인의 등록이 겹쳐도 어느 하나가 잃지 않게.
   */
  register(
    id: string,
    handler: CommandHandler,
    options?: CommandOptions,
  ): Disposable;
  /** 지금 부를 수 있는지. 올라와 있고 when이 막지 않아야 한다. */
  canRun(id: string): boolean;
  /**
   * 부른다. 없으면 not_found, when이 막으면 unavailable. handler가 던지면 log에 남기고 internal을
   * 돌린다. 던짐이 keydown listener까지 올라가 다른 키를 막지 않게.
   */
  execute(id: string, arg?: unknown): Result<null>;
}

interface Entry {
  readonly handler: CommandHandler;
  readonly when?: () => boolean;
}

export function createCommandRegistry(deps: {
  log: (message: string, error: unknown) => void;
}): CommandRegistry {
  const entries = new Map<string, Entry[]>();
  // 맨 나중에 올린 것이 이 id의 주인이다.
  const top = (id: string): Entry | undefined => entries.get(id)?.at(-1);
  return {
    register(id, handler, options) {
      const entry: Entry = { handler, when: options?.when };
      entries.set(id, [...(entries.get(id) ?? []), entry]);
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          const left = (entries.get(id) ?? []).filter((item) => item !== entry);
          if (left.length === 0) entries.delete(id);
          else entries.set(id, left);
        },
      };
    },
    canRun(id) {
      const entry = top(id);
      return entry !== undefined && (entry.when?.() ?? true);
    },
    execute(id, arg) {
      const entry = top(id);
      if (entry === undefined) {
        return err({ code: "not_found", message: `command ${id} 없음` });
      }
      if (entry.when?.() === false) {
        return err({ code: "unavailable", message: `command ${id} 꺼짐` });
      }
      try {
        entry.handler(arg);
        return ok(null);
      } catch (error) {
        deps.log(`command ${id} 실패`, error);
        return err(internalError());
      }
    },
  };
}
