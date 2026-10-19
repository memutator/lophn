// shell renderer와 main 사이 artifact 탭 경계.
// main·preload·renderer가 함께 부르므로 import는 zod뿐이다. main tsc는 protocol을 보지 않으므로
// slug·ID 규칙은 app-frame.ts처럼 protocol의 사본이다.
// view의 bounds·숨기기·폐기는 app-frame.ts의 shell:view-bounds, shell:views-hidden,
// shell:view-close를 그대로 쓴다(frame-router가 view_session으로 가른다).
import { z } from "zod";

const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";
const projectId = z.string().regex(new RegExp(`^prj_${ULID}$`));
// artifact 이름(폴더 이름). protocol slugSchema의 사본이다.
export const artifactNameSchema = z.string().max(63).regex(
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
);
const noControl = (value: string) => !/\p{Cc}/u.test(value);
const viewSession = z.string().min(1).refine(noControl);

export const ARTIFACT_OPEN_CHANNEL = "shell:artifact-open";
export const ARTIFACT_RELOAD_CHANNEL = "shell:artifact-reload";
export const ARTIFACT_LIST_CHANNEL = "shell:artifact-list";
// main → renderer push.
export const ARTIFACT_STATE_CHANNEL = "shell:artifact-state";
export const ARTIFACT_EVENT_CHANNEL = "shell:artifact-event";

// artifact는 project의 artifacts 폴더 안 이름이고, file은 사람이 고른 절대 path의 .html이다.
export const artifactSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("artifact"),
    project: projectId,
    name: artifactNameSchema,
  })
    .strict(),
  z.object({
    kind: z.literal("file"),
    project: projectId,
    path: z.string().min(1).max(4096).refine(noControl),
  }).strict(),
]);

export const artifactOpenSchema = z.object({ source: artifactSourceSchema })
  .strict();
export const artifactReloadSchema = z.object({ view_session: viewSession })
  .strict();
export const artifactListSchema = z.object({ project: projectId }).strict();

export const artifactViewStateSchema = z.object({
  view_session: viewSession,
  source: artifactSourceSchema,
  // 입구 file의 절대 path. Edit source가 연다.
  file: z.string(),
  // page의 title. load 전에는 빈 글이다.
  title: z.string(),
  loading: z.boolean(),
  health: z.enum(["ok", "unresponsive", "crashed"]),
}).strict();

// open-link: 사용자 입력 직후 page에서 누른 http/https link. renderer가 browser 탭으로 연다.
export const artifactEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("open-link"),
    view_session: viewSession,
    url: z.string(),
  }).strict(),
]);

export const artifactListItemSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  modified: z.string(),
}).strict();

export type ArtifactSource = z.infer<typeof artifactSourceSchema>;
export type ArtifactOpen = z.infer<typeof artifactOpenSchema>;
export type ArtifactReload = z.infer<typeof artifactReloadSchema>;
export type ArtifactList = z.infer<typeof artifactListSchema>;
export type ArtifactViewState = z.infer<typeof artifactViewStateSchema>;
export type ArtifactEvent = z.infer<typeof artifactEventSchema>;
export type ArtifactListItem = z.infer<typeof artifactListItemSchema>;

type ArtifactErrorCode =
  | "invalid_input"
  | "forbidden"
  | "not_found"
  | "unavailable";

/** main이 IPC로 돌려주는 모양(`BrowserReply`와 같다). */
export type ArtifactReply<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ArtifactErrorCode; message: string } };

/**
 * shell preload의 artifact API(window.lophnArtifact). 거절은 code만 실은 Error다.
 * open의 not_found는 폴더나 입구 file이 없다는 뜻이고 renderer는 placeholder를 그린다.
 * 봉한 session을 못 세웠으면 unavailable이다.
 */
export interface LophnArtifactApi {
  open(input: ArtifactOpen): Promise<ArtifactViewState>;
  reload(input: ArtifactReload): Promise<null>;
  list(input: ArtifactList): Promise<{ artifacts: ArtifactListItem[] }>;
  subscribeState(listener: (state: ArtifactViewState) => void): () => void;
  subscribeEvent(listener: (event: ArtifactEvent) => void): () => void;
}
