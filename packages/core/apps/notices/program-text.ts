import type { NoticeRecordInput } from "../../../protocol/apps/notice.ts";

// program 줄의 글은 여기 template과 매개변수로만 만든다. 앱이 쓴 글이 program 줄에 들어가지 않게 하려고
// command 입력에 title·body를 두지 않았다. 매개변수는 짧은 식별자와 core가 정한 이유 코드다(protocol/apps/notice.ts).
export function programNoticeText(input: NoticeRecordInput): {
  title: string;
  body: string;
} {
  switch (input.kind) {
    case "release_activated":
      return {
        title: `Release ${input.params.release} is live`,
        body: "",
      };
    case "release_failed":
      return {
        title: `Release ${input.params.release} failed`,
        body: input.params.reason,
      };
    case "release_rolled_back":
      return {
        title: `Release ${input.params.release} was rolled back`,
        body: `The app is running release ${input.params.to} again.`,
      };
    case "app_unavailable":
      return {
        title: "The app stopped and is not running",
        body: input.params.reason,
      };
    case "app_data_migrated":
      return {
        title: "App data was migrated",
        body: `Release ${input.params.release} changed the data and the migration was applied.`,
      };
    case "app_data_restored":
      return {
        title: "App data was restored from a backup",
        body: `The data was put back to what it was before release ${input.params.release}.`,
      };
    case "lophn_updated":
      return {
        title: `lophn was updated to ${input.params.to}`,
        body:
          input.params.from === "unknown"
            ? "The earlier version was not recorded."
            : `It was ${input.params.from} before.`,
      };
    case "session_stopped_by_app":
      return {
        title: "An app stopped an agent turn",
        body: `The running turn of ${input.params.title ?? input.params.session} was stopped.`,
      };
    case "sdk_update_needed": {
      const { required, available } = input.params;
      const apps = (count: number) =>
        `${count} ${count === 1 ? "app" : "apps"}`;
      // 앞 문장이 "N apps"를 썼으면 뒤는 수만 쓴다("3 apps must update, 2 can use ...").
      const parts = [
        required > 0 ? `${apps(required)} must update` : "",
        available > 0
          ? `${required > 0 ? available : apps(available)} can use new SDK features`
          : "",
      ].filter((part) => part !== "");
      return {
        title: "SDK updates for your apps",
        body: `${parts.join(", ")}.`,
      };
    }
  }
}
