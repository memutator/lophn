import type { Writer } from "../../storage/ledger/mod.ts";

// 앱 등록 command가 commit된 뒤 그 앱의 App Engineer 정의 파일을 만들어 둔다. 정의는 파일이라 앱 등록과 같은 tx에
// 묶을 수 없다. 파일을 만들지 못해도 등록은 그대로이고, 파일이 없는 App Engineer는 기본 정의로 읽힌다.
export function withAppEngineer(
  writer: Writer,
  ensure: (app: string) => void,
  registerCommand: string,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      const done = await writer.command(ctx, envelope);
      if (done.ok && envelope.command === registerCommand) {
        const app = done.value.result as { id?: unknown } | null;
        if (typeof app?.id === "string") {
          try {
            ensure(app.id);
          } catch {
            // 파일을 만들지 못해도 등록은 되었다.
          }
        }
      }
      return done;
    },
  };
}
