// The phone's data layer. Screens import only this file; they never touch a connection.
import "./crypto.ts";

export type { AcpState } from "../../../packages/protocol/acp/mod.ts";
export type { Notice } from "../../../packages/protocol/apps/notice.ts";
export type { AskAnswer } from "../../../packages/protocol/lophn-agent/ask-tool.ts";
export type {
  AgentId,
  Workspace,
} from "../../../packages/protocol/lophn-agent/workspaces.ts";
export type {
  AgentFace,
  AgentTabSource,
  Delivery,
  QuestionAnswer,
  QueuedView,
  SourceResult,
  ThreadEntry,
  ThreadView,
  TurnView,
} from "../../../packages/shell/renderer/conversation/agent-tab-source.ts";
export type {
  WaitingEntry,
  WaitingState,
} from "../../../packages/shell/renderer/desktop/connection/events/waiting-store.ts";
export type { WaitingChoice } from "../../../packages/shell/renderer/desktop/connection/waiting/decide.ts";
export {
  type History,
  type HistoryFilter,
  NO_FILTER,
  useHistory as useInboxHistory,
} from "../../../packages/shell/renderer/desktop/connection/waiting/history.ts";
export {
  type CardView,
  cardOf,
} from "../../../packages/shell/renderer/desktop/connection/waiting/model.ts";
export type { PairFailure } from "../pairing/pair.ts";
export type {
  ComputerItem,
  ComputerPath,
  ComputerStatus,
  Computers,
} from "./computers.ts";
export {
  type ComputersView,
  type Conversation,
  type ConversationTarget,
  DataProvider,
  type Inbox,
  useComputers,
  useConversation,
  useCurrentComputer,
  useInbox,
  useNames,
  useSampleConversation,
  useStartSession,
  useWorkspaces,
} from "./hooks.tsx";
export type { ComputerData, SampleConversation } from "./link.ts";
export { createPhoneComputers } from "./phone.ts";
export type {
  SessionGroup,
  SessionRow,
  SessionStatus,
  WaitingFor,
  Who,
  WorkspaceIcon,
  WorkspaceView,
} from "./workspaces.ts";
