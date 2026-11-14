// Settings › Keyboard가 쓰는 통로. 값은 선언 설정 `shell.keybindings`다. 화면은 `settings/list`를 useCoreRead로
// 읽고, read는 창에 덮는 쪽(main.tsx)이 쓴다.
import type {
  KeyOverrides,
  KeyPlatform,
} from "../../../../../protocol/shell/keybindings.ts";
import type { SourceResult } from "../source.ts";

/** 저장 모양. OS마다 따로다. 다른 OS의 값은 건드리지 않고 그대로 다시 쓴다. */
export type StoredKeybindings = Readonly<
  Partial<Record<KeyPlatform, KeyOverrides>>
>;

export interface KeyboardSource {
  read(): Promise<SourceResult<StoredKeybindings>>;
  write(value: StoredKeybindings): Promise<SourceResult<null>>;
}
