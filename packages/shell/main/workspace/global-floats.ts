// <data>/shell/global-floats.json은 main만 쓴다. workspace와 재시작을 넘는 전역 float의 탭, 접힘, rect, pin이다.
// 탭 값은 workspace layout 파일의 탭과 같다(kind registry가 검증하고 공통 칸 `machine`을 가진다). 파일이 없거나 틀리면 빈 목록이다.
// 판 1(앱 panel만, `{app, screen, ...}`)은 core의 data step `shell.global-floats-tabs`가 판 2로 옮기고, 판 2는 `shell.layout-machines`가
// 판 3으로 올린다(판 3은 workspace와 탭에 `machine`을 더했을 뿐이라 값은 그대로다).
import { join } from "node:path";
import { z } from "zod";

import {
  defaultStoreDeps,
  type StoreDeps,
  type StoreResult,
  writeFileAtomic,
} from "./atomic-file.ts";
import { idOf } from "./kinds/values.ts";
import { layoutTabSchema, windowBounds } from "./schema.ts";

export const GLOBAL_FLOATS_SCHEMA_VERSION = 3;
export const GLOBAL_FLOATS_MAX = 20;

// workspace가 다른 기계의 것이면 그 기계(`mch_`). 없으면 이 컴퓨터의 workspace다.
const workspaceMachine = z
  .string()
  .refine((value) => idOf("mch", value) !== null)
  .optional();

const globalFloat = z.strictObject({
  // 탭이 나온 workspace. 본문은 이 workspace의 통로로 그린다(터미널의 cwd, 파일의 folder).
  workspace: z.union([
    z.strictObject({
      kind: z.literal("project"),
      id: z.string().refine((value) => idOf("prj", value) !== null),
      machine: workspaceMachine,
    }),
    z.strictObject({
      kind: z.literal("app"),
      id: z.string().refine((value) => idOf("app", value) !== null),
      machine: workspaceMachine,
    }),
    z.strictObject({ kind: z.literal("home"), machine: workspaceMachine }),
  ]),
  tab: layoutTabSchema,
  // workspace layout의 float rect와 같은 기준(title bar 아래 창 몸통)이다.
  rect: windowBounds,
  minimized: z.boolean(),
  pinned: z.literal(true).optional(),
});

const floatList = z.array(globalFloat).max(GLOBAL_FLOATS_MAX);

export type GlobalFloat = z.infer<typeof globalFloat>;

export type GlobalFloatsWriteResult =
  | StoreResult<null>
  | { ok: false; error: { code: "invalid_input"; message: string } };

export interface GlobalFloatsStore {
  /** 아래에서 위 순서. 파일이 없거나 틀리거나 다른 판이면 빈 목록이고, 틀린 float은 그것만 뺀다. */
  read(): Promise<GlobalFloat[]>;
  /** 검증한 값을 원자 교체로 쓴다. 검증에 실패하면 `invalid_input`이고 파일은 그대로다. */
  write(floats: unknown): Promise<GlobalFloatsWriteResult>;
  /** 이 컴퓨터에서 지운 앱의 화면 float과 그 앱 workspace에서 온 float을 목록에서 뺀다(다른 기계의 같은 앱 id는 그 기계의 것이라 남는다). 없으면 파일을 건드리지 않는다. */
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
        const parsed = JSON.parse(new TextDecoder().decode(raw)) as {
          schema_version?: unknown;
          floats?: unknown;
        } | null;
        if (
          parsed?.schema_version !== GLOBAL_FLOATS_SCHEMA_VERSION ||
          !Array.isArray(parsed.floats)
        ) {
          return [];
        }
        // 등록되지 않은 kind나 틀린 탭 하나가 나머지 float을 막지 않는다.
        return parsed.floats
          .flatMap((item) => {
            const one = globalFloat.safeParse(item);
            return one.success ? [one.data] : [];
          })
          .slice(0, GLOBAL_FLOATS_MAX);
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
      // 탭의 기계는 탭의 `machine`, 없으면 workspace의 기계다.
      const gone = (item: GlobalFloat) =>
        item.workspace.machine === undefined &&
        ((item.workspace.kind === "app" && item.workspace.id === app) ||
          ((item.tab.kind === "app_panel" || item.tab.kind === "app_screen") &&
            item.tab.machine === undefined &&
            item.tab.app === app));
      if (!floats.some(gone)) return { ok: true, value: null };
      return store.write(floats.filter((item) => !gone(item)));
    },
  };
  return store;
}
