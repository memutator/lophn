// core의 host queue 요청(agent가 연 탭)을 창에 잇는 경계. main이 core에서 가져온 요청을 그 workspace를 보이는 창에 push하고,
// renderer는 탭을 연 뒤에만 ack한다. 창은 자기가 보이는 workspace와 host 탭의 browser 상태·닫힘을 main에 알린다.
// main·preload·renderer가 함께 부르므로 import는 zod와 type뿐이다.
import { z } from "zod";
import type { HostRequest } from "../../protocol/lophn-agent/host-queue.ts";

const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";
const id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_${ULID}$`));

/** 창이 보이는 workspace. 보이는 workspace가 없어지면(Settings 등) null이다. */
export const surfaceWorkspaceSchema = z
  .object({
    workspace: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("home") }).strict(),
        z.object({ kind: z.literal("project"), id: id("prj") }).strict(),
        z.object({ kind: z.literal("app"), id: id("app") }).strict(),
      ])
      .nullable(),
  })
  .strict();

/** 요청대로 탭을 열었거나 닫았으면 opened다. 못 했으면 ack하지 않는다(main이 retry로 되돌린다). */
export const surfaceAckSchema = z
  .object({ request: id("hrq"), opened: z.boolean() })
  .strict();

const terminalRef = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);

/**
 * host 탭(key가 `host:<tab>`)의 browser 상태나 닫힘, 또는 agent가 `--tui`로 연 TUI 탭이 생겼다는 것(터미널은 아직 없다)과
 * 그 터미널이 열렸다는 것(terminal_ref). main은 탭이 열려 있는 동안 session을 hold하고 TUI가 떠나면 푼다.
 */
export const surfaceReportSchema = z.union([
  z
    .object({
      tab: id("tab"),
      state: z.union([
        z
          .object({
            url: z.string(),
            title: z.string().max(1024),
            loading: z.boolean(),
          })
          .strict(),
        z.literal("closed"),
      ]),
    })
    .strict(),
  z
    .object({
      tui: z
        .object({
          tab: id("tab"),
          session: id("ses"),
          terminal_ref: terminalRef.optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type SurfaceWorkspace = z.infer<typeof surfaceWorkspaceSchema>;
export type SurfaceAck = z.infer<typeof surfaceAckSchema>;
export type SurfaceReport = z.infer<typeof surfaceReportSchema>;

/** main이 창에 push하는 요청. */
export type SurfaceRequest = { request: HostRequest };

/** preload가 shell renderer에 여는 통로. */
export interface LophnSurfaceApi {
  /** main이 push한 요청마다 부른다. 구독 해지를 돌려준다. */
  on(listener: (request: SurfaceRequest) => void): () => void;
  ack(input: SurfaceAck): Promise<void>;
  workspace(input: SurfaceWorkspace): Promise<void>;
  report(input: SurfaceReport): Promise<void>;
}

export const SURFACE_REQUEST_CHANNEL = "shell:surface-request";
export const SURFACE_ACK_CHANNEL = "shell:surface-ack";
export const SURFACE_WORKSPACE_CHANNEL = "shell:surface-workspace";
export const SURFACE_REPORT_CHANNEL = "shell:surface-report";
