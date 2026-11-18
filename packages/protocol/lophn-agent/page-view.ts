import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory, defineRead } from "../base/route.ts";

// 사람이 다른 기기(폰, 다른 기계의 desktop)에서 이 기계의 browser 탭을 보고 다루는 route다. 터미널 보기(`coding-agent/terminal-view.ts`)와
// 같은 꼴이다:
// - 보는 쪽이 `watch`로 lease(PAGE_VIEW_LEASE_MS)를 잡고 PAGE_VIEW_RENEW_MS마다 갱신한다. 탭마다 lease가 하나라도 있는 동안 core가
//   host에 그 page의 frame을 켜 달라고 시키고(`page_stream`), 마지막 lease가 끝나면 끈다. 보는 쪽이 없으면 host는 frame을 만들지 않는다.
// - host가 frame을 밀면(`page_frame`) core는 탭마다 최신 frame 하나만 메모리에 두고(ledger 없음) 내용 없는 `PageViewChanged`를 낸다.
//   보는 쪽은 `snapshot`을 다시 읽는다. 상태(그리는가, take control)가 바뀌어도(`page_state`) 같은 event다.
// - 읽어 간 만큼만 다음 frame이 간다: core는 보는 쪽에 frame을 내준 뒤 host에 `page_read`를 보내고, host는 그것이 올 때까지 다음 frame을
//   보내지 않는다. 느린 연결에서는 frame이 건너뛰어질 뿐 쌓이지 않는다.
// 대상은 core가 아는 browser 탭(agent가 `tab open --url`로 연 탭과 사람이 `open`으로 연 탭)이다. 보는 것은 사람의 기기 모두, 다루는 것
// (`input`, `control`, `open`)은 터미널 입력을 허락받은 기기다. agent 자격은 이 route를 부르지 못한다.

export const PAGE_VIEW_LEASE_MS = 30_000;
export const PAGE_VIEW_RENEW_MS = 10_000;
// JPEG 한 장의 상한이다(base64 전).
export const PAGE_FRAME_MAX_BYTES = 2 * 1024 * 1024;

const coordinateSchema = z.number().min(0).max(100_000);
const deltaSchema = z.number().int().min(-100_000).max(100_000);

// 보는 쪽의 입력 하나다. 좌표는 보는 쪽이 본 frame의 page CSS px다. pointer는 왼쪽 단추 하나의 down·move·up이다(폰의 손가락과
// desktop의 click·끌기를 같은 꼴로 받는다. hover는 없다).
export const pageInputSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("pointer"),
    phase: z.enum(["down", "move", "up"]),
    x: coordinateSchema,
    y: coordinateSchema,
  }),
  z.strictObject({
    type: z.literal("scroll"),
    x: coordinateSchema,
    y: coordinateSchema,
    dx: deltaSchema,
    dy: deltaSchema,
  }),
  z.strictObject({
    type: z.literal("text"),
    text: z.string().min(1).max(1000),
  }),
  // agent의 `press`와 같은 key 이름이다("Enter", "Control+a").
  z.strictObject({ type: z.literal("key"), key: z.string().min(1).max(64) }),
  z.strictObject({
    type: z.literal("navigate"),
    url: z.string().min(1).max(8192),
  }),
  z.strictObject({ type: z.literal("back") }),
  z.strictObject({ type: z.literal("reload") }),
]);
export type PageInput = z.infer<typeof pageInputSchema>;

// page의 frame 한 장이다. width·height는 그 frame이 보이는 viewport의 CSS px다(보는 쪽이 좌표를 이 크기로 바꾼다).
export const pageFrameSchema = z.strictObject({
  media_type: z.literal("image/jpeg"),
  data_base64: z
    .string()
    .min(1)
    .max(Math.ceil(PAGE_FRAME_MAX_BYTES / 3) * 4),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});
export type PageFrame = z.infer<typeof pageFrameSchema>;

const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;

const tabSchema = idSchema("tab");
// 다시 보낸 호출을 알아보는 값이다. 같은 key는 한 번만 한다(`terminals/input`과 같다).
const keySchema = z.string().min(1).max(200);

const pageFields = {
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
  // 연 agent의 이름이다. 사람이 연 탭은 null이다.
  by: z.string().nullable(),
};

// core가 아는 browser 탭이다.
export const pageViewList = defineRead({
  resource: "page_view",
  method: "list",
  name: "PageViewList",
  input: z.strictObject({}),
  output: z.strictObject({
    pages: z.array(z.strictObject({ tab: tabSchema, ...pageFields })),
  }),
  actors: ["user"],
  errors,
});

// 탭의 최신 frame과 상태다. seq는 core가 그 탭의 frame이나 상태가 바뀔 때마다 올린다(`PageViewChanged`의 seq). frame은 아직 오지
// 않았으면 null이다. painting은 host가 그 page를 그리는가다(창이 최소화되거나 숨겨지면 false이고 frame이 오지 않는다). agent는 agent가
// 그 탭을 다루는 중인가, held는 사람이 가져왔는가(take control)다. control은 부른 principal이 이 탭을 다룰 수 있는가다.
export const pageViewSnapshot = defineRead({
  resource: "page_view",
  method: "snapshot",
  name: "PageViewSnapshot",
  input: z.strictObject({ tab: tabSchema }),
  output: z.strictObject({
    tab: tabSchema,
    seq: z.number().int().min(0),
    frame: pageFrameSchema.nullable(),
    painting: z.boolean(),
    agent: z.boolean(),
    held: z.boolean(),
    ...pageFields,
    control: z.boolean(),
  }),
  actors: ["user"],
  errors,
});

// 이 principal이 이 탭을 본다(lease PAGE_VIEW_LEASE_MS). 보는 쪽이 PAGE_VIEW_RENEW_MS마다 같은 호출로 갱신한다.
export const pageViewWatch = defineMemory({
  resource: "page_view",
  method: "watch",
  name: "PageViewWatch",
  changes: [],
  input: z.strictObject({ tab: tabSchema, on: z.boolean() }),
  output: z.strictObject({}),
  actors: ["user"],
  errors,
});

export const pageViewInput = defineMemory({
  resource: "page_view",
  method: "input",
  name: "PageViewInput",
  changes: [],
  input: z.strictObject({
    tab: tabSchema,
    key: keySchema,
    input: pageInputSchema,
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors,
});

// 사람이 멀리서 탭을 가져오거나(held true) 돌려준다. 그 기계의 take control과 같아 가져온 동안 agent의 쓰기 동작이 `conflict`다.
export const pageViewControl = defineMemory({
  resource: "page_view",
  method: "control",
  name: "PageViewControl",
  changes: [],
  input: z.strictObject({ tab: tabSchema, held: z.boolean() }),
  output: z.strictObject({}),
  actors: ["user"],
  errors,
});

// 사람이 그 기계에 browser 탭을 연다(http·https). 화면 없는 기계의 로그인은 이 탭을 멀리서 보며 한다.
export const pageViewOpen = defineMemory({
  resource: "page_view",
  method: "open",
  name: "PageViewOpen",
  changes: ["browser_pages"],
  input: z.strictObject({ url: z.string().min(1).max(8192), key: keySchema }),
  output: z.strictObject({ tab: tabSchema }),
  actors: ["user"],
  errors,
});

export const PAGE_VIEW_ROUTES = [
  pageViewList,
  pageViewSnapshot,
  pageViewWatch,
  pageViewInput,
  pageViewControl,
  pageViewOpen,
] as const;
