// core의 host queue 요청(agent가 연 탭)을 창에 잇는 경계. main이 core에서 가져온 요청을 그 workspace를 보이는 창에 push하고,
// renderer는 탭을 연 뒤에만 ack한다. 창은 자기가 보이는 workspace와 host 탭의 browser 상태·닫힘·view session(bind)을 main에 알린다.
// agent가 browser·preview 탭을 다루는 동안의 take control 상태는 main이 push하고, 사람이 가져오기·돌려주기를 main에 보낸다.
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
 * bind는 browser·preview 탭의 view session을 알 때와 바뀔 때 알린다(main만 쓰고 core에는 가지 않는다). 닫힘은 `state: "closed"`가 푼다.
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
      bind: z
        .object({ tab: id("tab"), view_session: z.string().min(1).max(200) })
        .strict(),
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

/** 사람이 탭을 가져오거나(held) 돌려준다. */
export const surfaceTakeSchema = z
  .object({ tab: id("tab"), held: z.boolean() })
  .strict();

/**
 * preview 탭이 고른 기기를 그 탭의 view에 건다(null이면 푼다). 범위는 core의 설정 `shell.devices`와 같다(shell은 core를 import하지 못한다).
 * DevTools가 열려 있으면 걸 수 없어 `devtools`로 답한다.
 */
export const surfaceDeviceSchema = z
  .object({
    width: z.number().int().min(200).max(2000),
    height: z.number().int().min(200).max(3000),
    dpr: z.number().min(1).max(4),
    os: z.enum(["ios", "android"]),
  })
  .strict();
export const surfaceEmulateSchema = z
  .object({
    view_session: z.string().min(1).max(200),
    device: surfaceDeviceSchema.nullable(),
  })
  .strict();
export type EmulationDevice = z.infer<typeof surfaceDeviceSchema>;
export type SurfaceEmulate = z.infer<typeof surfaceEmulateSchema>;
export type SurfaceEmulateResult =
  | { ok: true }
  | { ok: false; reason: "devtools" | "unavailable" };

export type SurfaceWorkspace = z.infer<typeof surfaceWorkspaceSchema>;
export type SurfaceAck = z.infer<typeof surfaceAckSchema>;
export type SurfaceReport = z.infer<typeof surfaceReportSchema>;
export type SurfaceTake = z.infer<typeof surfaceTakeSchema>;

/** main이 창에 push하는 탭의 take control 상태. agent가 그 탭을 다루는 중이면 agent, 사람이 가져왔으면 held다. */
export type SurfaceControl = { tab: string; agent: boolean; held: boolean };

/** main이 창에 push하는 요청. extension tool 호출(`tool_call`)과 browser 호출(`browser_call`)은 main이 처리하므로 창에 오지 않는다. */
export type SurfaceRequest = {
  request: Exclude<HostRequest, { kind: "tool_call" | "browser_call" }>;
};

/** preload가 shell renderer에 여는 통로. */
export interface LophnSurfaceApi {
  /** main이 push한 요청마다 부른다. 구독 해지를 돌려준다. */
  on(listener: (request: SurfaceRequest) => void): () => void;
  ack(input: SurfaceAck): Promise<void>;
  workspace(input: SurfaceWorkspace): Promise<void>;
  report(input: SurfaceReport): Promise<void>;
  /** 탭의 take control 상태가 바뀔 때마다 부른다. 구독 해지를 돌려준다. */
  control(listener: (control: SurfaceControl) => void): () => void;
  /** 사람이 그 탭을 가져온다. agent의 쓰기(act, navigate, evaluate)는 conflict가 된다. */
  take(tab: string): Promise<void>;
  release(tab: string): Promise<void>;
  /** preview view에 기기 emulation을 건다. null이면 푼다. */
  emulate(input: SurfaceEmulate): Promise<SurfaceEmulateResult>;
}

export const SURFACE_REQUEST_CHANNEL = "shell:surface-request";
export const SURFACE_ACK_CHANNEL = "shell:surface-ack";
export const SURFACE_WORKSPACE_CHANNEL = "shell:surface-workspace";
export const SURFACE_REPORT_CHANNEL = "shell:surface-report";
export const SURFACE_CONTROL_CHANNEL = "shell:surface-control";
export const SURFACE_TAKE_CHANNEL = "shell:surface-take";
export const SURFACE_EMULATE_CHANNEL = "shell:surface-emulate";
