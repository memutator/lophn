// 마지막 desktop 창의 자리·크기·최대화를 앱 하나에 하나 기억한다(<home>/shell/window.json). 새 창과 다음
// 실행이 그 자리로 연다. project나 화면마다 따로 두지 않는다. 쓰는 것은 main뿐이고 원자 교체다.
import { join } from "node:path";
import { z } from "zod";

import {
  defaultStoreDeps,
  type StoreDeps,
  writeFileAtomic,
} from "./atomic-file.ts";

const coordinate = z.number().int().min(-32768).max(32768);
const extent = z.number().int().min(1).max(32768);

const windowStateSchema = z.strictObject({
  // 최대화·전체 화면이어도 되돌렸을 때의 자리다.
  bounds: z.strictObject({
    x: coordinate,
    y: coordinate,
    width: extent,
    height: extent,
  }),
  maximized: z.boolean(),
});

export type WindowState = z.infer<typeof windowStateSchema>;

export interface WindowStateStore {
  /** 저장한 적 없거나 읽을 수 없거나 모양이 틀리면 null이다. 기본 크기로 열면 된다. */
  read(): Promise<WindowState | null>;
  /** 원자 교체로 쓴다. 실패해도 앞 파일이 남고 창은 그대로다. */
  write(state: WindowState): Promise<void>;
}

export function createWindowStateStore(
  dataRoot: string,
  deps: Partial<StoreDeps> = {},
): WindowStateStore {
  const impl: StoreDeps = { ...defaultStoreDeps, ...deps };
  const file = join(dataRoot, "shell", "window.json");
  return {
    async read() {
      try {
        const raw = new TextDecoder().decode(await impl.readFile(file));
        const parsed = windowStateSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async write(state) {
      await writeFileAtomic(file, JSON.stringify(state), impl);
    },
  };
}
