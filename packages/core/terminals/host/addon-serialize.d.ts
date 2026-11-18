// @xterm/addon-serialize의 typing은 @xterm/xterm을 import하고, 그것이 `/// <reference lib="dom"/>`을 켜서
// node project 전체의 WebSocket 같은 전역 type이 DOM 것으로 바뀐다. 쓰는 만큼만 따로 적는다.
declare module "@xterm/addon-serialize/lib/addon-serialize.js" {
  export class SerializeAddon {
    activate(terminal: unknown): void;
    dispose(): void;
    serialize(options?: { scrollback?: number }): string;
  }
}
