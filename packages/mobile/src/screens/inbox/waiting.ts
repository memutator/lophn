// The desktop Inbox's own helpers the phone screens use as they are: names for a job's schedule, a notice's kind and an
// agent. They are pure functions of the waiting model's values; only what the data layer does not already export.
export type { AskQuestion } from "../../../../protocol/lophn-agent/ask-tool.ts";
export { isLophn } from "../../../../protocol/lophn-agent/workspaces.ts";
export { jobHoldNote } from "../../../../shell/renderer/desktop/connection/waiting/model.ts";
export { KIND_LABEL } from "../../../../shell/renderer/desktop/connection/waiting/notice-kinds.ts";
export {
  intervalText,
  scheduleText,
} from "../../../../shell/renderer/desktop/jobs/model.ts";
