// ContextFiles의 동기 file API 구현. 동기 file API는 core 본체의 module graph에 들어오면 안 되므로
// writer·reader Worker 안의 deps.ts만 이 파일을 연다.
import { err, ok } from "../../../../base/mod.ts";
import type { ContextFiles } from "../folders.ts";

export function createContextFiles(): ContextFiles {
  return {
    read(path) {
      let text: string;
      try {
        text = Deno.readTextFileSync(path);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return ok(null);
        return err({ code: "unavailable", message: "cannot read the file" });
      }
      try {
        return ok(JSON.parse(text));
      } catch {
        return err({ code: "invalid_input", message: "the file is not JSON" });
      }
    },
    write(path, value) {
      Deno.mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      Deno.writeTextFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    },
    remove(path) {
      try {
        Deno.removeSync(path, { recursive: true });
      } catch { /* 없으면 그대로 둔다 */ }
    },
  };
}
