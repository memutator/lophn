import { z } from "zod";
import { appViewIdSchema } from "../apps/views.ts";

// core가 폰의 preview 화면을 다루려고 폰 link로 묻는 kind 넷(`drive.snapshot`·`drive.act`·`drive.screenshot`·`drive.wait`)이다.
// `kinds.ts`의 `PHONE_KINDS`에 올라 있다. preview만 다루고 live는 다루지 않는다.
//
// 모든 입력에 공통인 칸:
// - view: core가 고른, 이 폰이 연 preview view다. 폰은 그 view가 아니거나 guest가 닫혔으면 `unavailable`(`no_preview`)로 거절한다.
// - by: 부르는 agent의 이름이다(사람 token이면 "Someone on your computer"). 폰의 "is driving" 줄이 쓴다.

const viewInput = {
  view: appViewIdSchema,
  by: z.string().min(1).max(80),
};

// 폰이 snapshot마다 매기는 번호(`node`)와 id(`snapshot`)를 낸다. core는 탭의 counter로 `eN` ref를 매기고 `eN → (view, snapshot, node)`를 든다.
export const driveNodeSchema = z.strictObject({
  node: z.number().int().min(1).max(1_000_000),
  depth: z.number().int().min(0).max(100),
  // 소문자: button, switch, checkbox, tab, tablist, link, header, textbox, image, text, list, listitem, scrollview, generic 가운데.
  role: z.string().min(1).max(32),
  name: z.string().max(200),
  // secure 칸은 "••••"이다.
  value: z.string().max(200).optional(),
  flags: z.array(
    z.enum(["disabled", "checked", "selected", "scrollable", "offscreen"]),
  ),
});
export type DriveNode = z.infer<typeof driveNodeSchema>;

export const DRIVE_SNAPSHOT_NODES_MAX = 5000;

// snapshot 글의 규칙이다(core가 `nodes`로 쓴다):
// - 첫 줄은 `screen <key> <w>x<h>dp`이고 ref가 없다.
// - 줄마다 `<depth만큼 두 칸>- <role>[ "<name>"][ value="<value>"][ [flag]…] [ref=eN]`이다. 이름이 비면 뺀다. name·value는 JSON 문자열로
//   escape한다. desktop snapshot 줄과 같은 순서에 flag만 더한다.
// - 전체가 `SNAPSHOT_MAX`(60_000)를 넘으면 그 앞에서 자르고 마지막에 `[truncated]` 줄을 둔다.
// - ref는 탭마다 늘기만 하는 counter다. 새 snapshot이 옛 ref를 새 node로 옮기지 않는다.
export const driveSnapshotInputSchema = z.strictObject(viewInput);
export const driveSnapshotOutputSchema = z.strictObject({
  snapshot: z.string().min(1).max(64),
  width_dp: z.number().int(),
  height_dp: z.number().int(),
  nodes: z.array(driveNodeSchema).max(DRIVE_SNAPSHOT_NODES_MAX),
});
export type DriveSnapshotOutput = z.infer<typeof driveSnapshotOutputSchema>;

// `snapshot`은 core가 마지막으로 받은 snapshot id다. 그것이 폰의 마지막이 아니거나 node가 사라졌거나 role·name이 바뀌었으면 `conflict`(`stale_ref`)다.
// - click: node를 누른다.
// - type: node 끝에 글을 붙인다. 글을 칠 수 없는 node면 `invalid_input`.
// - fill: node의 글을 바꾼다. 글을 칠 수 없는 node면 `invalid_input`.
// - press: Enter만 된다. node가 있으면 그 칸에서.
// - scroll: node면 그것을 화면 안으로 들이고(못 들이면 `conflict` `off_screen`), 아니면 화면을 dy dp만큼 민다.
export const driveActSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("click"),
    node: z.number().int().min(1).max(1_000_000),
  }),
  z.strictObject({
    type: z.literal("type"),
    node: z.number().int().min(1).max(1_000_000),
    text: z.string().max(10_000),
  }),
  z.strictObject({
    type: z.literal("fill"),
    node: z.number().int().min(1).max(1_000_000),
    text: z.string().max(10_000),
  }),
  z.strictObject({
    type: z.literal("press"),
    key: z.literal("Enter"),
    node: z.number().int().min(1).max(1_000_000).optional(),
  }),
  z.strictObject({
    type: z.literal("scroll"),
    node: z.number().int().min(1).max(1_000_000).optional(),
    dy: z.number().int().min(-100_000).max(100_000).optional(),
  }),
]);
export type DriveAct = z.infer<typeof driveActSchema>;

// 사람이 take control 중이면 폰은 `conflict`(`taken_over`)로 거절한다. act만이고 읽기(snapshot·screenshot·wait)는 된다.
export const driveActInputSchema = z.strictObject({
  ...viewInput,
  snapshot: z.string().min(1).max(64),
  act: driveActSchema,
});
export const driveActOutputSchema = z.strictObject({});

// 풀린 bytes의 상한이다(`PHONE_RESPONSE_BYTES_MAX` 안). 폰은 기본 JPEG q80·긴 변 1080 px로 낸다.
export const DRIVE_SCREENSHOT_BYTES_MAX = 1024 * 1024;
export const driveScreenshotInputSchema = z.strictObject({
  ...viewInput,
  format: z.enum(["jpeg", "png"]).default("jpeg"),
});
export const driveScreenshotOutputSchema = z.strictObject({
  media_type: z.enum(["image/jpeg", "image/png"]),
  data_base64: z.string(),
  width: z.number().int(),
  height: z.number().int(),
});

// `timeout_ms`가 지나도 글이 없으면 `found: false`다(오류가 아니다). core의 deadline은 `timeout_ms + 5_000`이다.
export const driveWaitInputSchema = z.strictObject({
  ...viewInput,
  text: z.string().min(1).max(1000),
  timeout_ms: z.number().int().min(100).max(25_000),
});
export const driveWaitOutputSchema = z.strictObject({ found: z.boolean() });

// `conflict` 오류의 `details.reason`이다.
// - taken_over: 사람이 take control 중이다(act만)
// - stale_ref: 그 snapshot이 마지막이 아니거나 node가 사라졌거나 role·name이 바뀌었다
// - off_screen: node를 화면 안으로 들이지 못했다
export const driveConflictReasonSchema = z.enum([
  "taken_over",
  "stale_ref",
  "off_screen",
]);
export type DriveConflictReason = z.infer<typeof driveConflictReasonSchema>;

// core가 phone 탭의 오류에 그대로 싣는 문장이다(model이 읽는다). 원인, 다음 할 일, 되풀이가 통하는지를 말한다.
export const PHONE_TAB_TEXT = {
  notShowing:
    "The phone is not showing a preview of this app, so there is nothing to drive. Ask the person to open the app in the lophn app on the phone and choose Preview from lophn, then try again; retrying before that does not help.",
  notInFront:
    "The lophn app on the phone is not in front or the phone screen is off, so lophn cannot drive it. Ask the person to unlock the phone and keep the preview open, then try again.",
  covered:
    "Something on the phone (a sheet, a dialog or the notification shade) covers the preview, so lophn cannot read or drive it; what a sheet or dialog shows is not part of the screen lophn reads. Ask the person to close it on the phone and to check that part by hand, then try again.",
  tooOld:
    "The lophn app on the phone is too old to be driven. Ask the person to update the lophn app on the phone.",
  timedOut:
    "The phone did not answer in time. Try once more; if it fails again, ask the person to check the phone.",
  takenOver:
    "The person took control of this phone screen, so lophn does not act on it; snapshot and screenshot still work. Wait until the person hands it back, or ask them.",
  staleRef:
    "This ref is from an older snapshot or the element is gone. Run browser snapshot again and use the new refs.",
  offScreen:
    "lophn could not bring this element on screen to touch it. Scroll with browser act scroll, run browser snapshot again and use the new ref.",
  unsupported: (name: string) =>
    `A phone tab supports snapshot, screenshot, read, wait --text and act click, type, fill, press Enter and scroll; ${name} is not available on the phone.`,
  noShow:
    "A phone tab is on the phone, not in the lophn app on this computer; ask the person to look at the phone.",
} as const;
