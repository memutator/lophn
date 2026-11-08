// @xterm/addon-unicode11의 typing도 @xterm/xterm을 import해 DOM 전역 type을 켠다(`addon-serialize.d.ts`와 같은 이유).
declare module "@xterm/addon-unicode11/lib/addon-unicode11.js" {
  export class Unicode11Addon {
    activate(terminal: unknown): void;
    dispose(): void;
  }
}
