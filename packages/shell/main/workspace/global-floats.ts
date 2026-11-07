// <data>/shell/global-floats.json은 main만 쓴다. workspace와 재시작을 넘는 전역 float(앱 panel 화면)의 접힘, rect, pin이다.
// workspace layout 파일과 별개다(그 schema는 건드리지 않는다). 파일이 없거나 틀리면 빈 목록이다.
import { join } from "node:path";
import { z } from "zod";

import {
  defaultStoreDeps,
  type StoreDeps,
  type StoreResult,
  writeFileAtomic,
} from "./atomic-file.ts";
import { appId } from "./kinds/values.ts";
import { windowBounds } from "./schema.ts";

export const GLOBAL_FLOATS_SCHEMA_VERSION = 1;
export const GLOBAL_FLOATS_MAX = 20;

const globalFloat = z.strictObject({
  app: appId,
  screen: z.string().min(1).max(128),
  // workspace layout의 float rect와 같은 기준(title bar 아래 창 몸통)이다.
  rect: windowBounds,
  minimized: z.boolean(),
  pinned: z.literal(true).optional(),
});

const floatList = z.array(globalFloat).max(GLOBAL_FLOATS_MAX);

const globalFloatsFile = z.strictObject({
  schema_version: z.literal(GLOBAL_FLOATS_SCHEMA_VERSION),
  floats: floatList,
});

export type GlobalFloat = z.infer<typeof globalFloat>;

export type GlobalFloatsWriteResult =
  | StoreResult<null>
  | { ok: false; error: { code: "invalid_input"; message: string } };

export interface GlobalFloatsStore {
  /** 아래에서 위 순서. 파일이 없거나 틀리거나 다른 판이면 빈 목록이다. */
  read(): Promise<GlobalFloat[]>;
  /** 검증한 값을 원자 교체로 쓴다. 검증에 실패하면 `invalid_input`이고 파일은 그대로다. */
  write(floats: unknown): Promise<GlobalFloatsWriteResult>;
  /** 지운 앱의 float을 목록에서 뺀다. 그 앱의 float이 없으면 파일을 건드리지 않는다. */
  removeApp(app: string): Promise<GlobalFloatsWriteResult>;
}

export function createGlobalFloatsStore(
  dataRoot: string,
  deps: Partial<StoreDeps> = {},
): GlobalFloatsStore {
  const impl: StoreDeps = { ...defaultStoreDeps, ...deps };
  const file = join(dataRoot, "shell", "global-floats.json");
  const store: GlobalFloatsStore = {
    async read() {
      try {
        const raw = await impl.readFile(file);
        const parsed = globalFloatsFile.safeParse(
          JSON.parse(new TextDecoder().decode(raw)),
        );
        return parsed.success ? parsed.data.floats : [];
      } catch {
        return [];
      }
    },
    async write(floats) {
      const valid = floatList.safeParse(floats);
      if (!valid.success) {
        return {
          ok: false,
          error: { code: "invalid_input", message: "invalid global floats" },
        };
      }
      return writeFileAtomic(
        file,
        JSON.stringify({
          schema_version: GLOBAL_FLOATS_SCHEMA_VERSION,
          floats: valid.data,
        }),
        impl,
      );
    },
    async removeApp(app) {
      const floats = await store.read();
      if (!floats.some((item) => item.app === app)) {
        return { ok: true, value: null };
      }
      return store.write(floats.filter((item) => item.app !== app));
    },
  };
  return store;
}
