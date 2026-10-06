// preview의 disposable 영역(apps/preview#R2). `apps/<app ID>/preview/<process nonce>/`에 만들고
// fixture를 `data.db`로 놓는다. 운영 DB·backup·files는 어떤 경로로도 복사하지 않는다. 종료 확인 뒤
// 폐기한다. core 안에서 쓰므로 동기 파일 I/O를 쓰지 않는다.
import { err, ok, type Result } from "../../base/mod.ts";
import { appIdSchema } from "../../contracts/apps/mod.ts";
import { previewDirectory, validNonce } from "./model.ts";

export type PreviewArea = {
  // 영역을 만들고 (있으면) fixture byte를 data.db로 놓는다. 영역의 절대 경로를 돌려준다.
  create(
    app: string,
    nonce: string,
    fixture: Uint8Array | null,
  ): Promise<Result<string>>;
  discard(app: string, nonce: string): Promise<void>;
  // core 시작 때 지난 실행이 남긴 영역을 모두 지운다. preview 프로세스는 core와 함께 끝나므로
  // 시작 시점에 살아 있는 preview는 없다.
  discardAll(): Promise<void>;
};

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export function createFsPreviewArea(dataRoot: string): PreviewArea {
  function directoryOf(app: string, nonce: string): string | undefined {
    if (!appIdSchema.safeParse(app).success || !validNonce(nonce)) {
      return undefined;
    }
    return previewDirectory(dataRoot, app, nonce);
  }
  return {
    async create(app, nonce, fixture) {
      const directory = directoryOf(app, nonce);
      if (directory === undefined) {
        return err({ code: "invalid_input", message: "preview id is invalid" });
      }
      try {
        await Deno.mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
        await Deno.mkdir(`${directory}/files`, { mode: DIRECTORY_MODE });
        if (fixture !== null) {
          await Deno.writeFile(`${directory}/data.db`, fixture, {
            createNew: true,
            mode: FILE_MODE,
          });
        }
      } catch {
        await Deno.remove(directory, { recursive: true }).catch(() => {});
        return err({
          code: "unavailable",
          message: "preview data area could not be created",
        });
      }
      return ok(directory);
    },
    async discard(app, nonce) {
      const directory = directoryOf(app, nonce);
      if (directory === undefined) return;
      await Deno.remove(directory, { recursive: true }).catch(() => {});
    },
    async discardAll() {
      let apps: string[];
      try {
        apps = [];
        for await (const entry of Deno.readDir(`${dataRoot}/apps`)) {
          if (entry.isDirectory && appIdSchema.safeParse(entry.name).success) {
            apps.push(entry.name);
          }
        }
      } catch {
        return;
      }
      for (const app of apps) {
        await Deno.remove(`${dataRoot}/apps/${app}/preview`, {
          recursive: true,
        }).catch(() => {});
      }
    },
  };
}
