// Settings › Keyboard가 읽고 쓰는 통로. 값은 선언 설정 `shell.keybindings`다. 화면은 이 interface만 보고
// core route 이름은 core-source.ts만 안다.
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
  /** core 연결 상태를 듣는다. 준비되면 다시 읽는다. 해제는 반환 함수다. */
  watch(listener: (state: { readonly state: string }) => void): () => void;
  read(): Promise<SourceResult<StoredKeybindings>>;
  write(value: StoredKeybindings): Promise<SourceResult<null>>;
}
