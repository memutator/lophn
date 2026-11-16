// The phone's data layer. Screens import their reads only from this file; they never touch a connection.
import "./crypto.ts";

export type { AcpState } from "../../../protocol/acp/mod.ts";
export type { Notice } from "../../../protocol/apps/notice.ts";
export type { AskAnswer } from "../../../protocol/lophn-agent/ask-tool.ts";
export type {
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
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
} from "../../../shell/renderer/conversation/agent-tab-source.ts";
export type {
  WaitingEntry,
  WaitingState,
} from "../../../shell/renderer/desktop/connection/events/waiting-store.ts";
export type { WaitingChoice } from "../../../shell/renderer/desktop/connection/waiting/decide.ts";
export {
  type History,
  type HistoryFilter,
  NO_FILTER,
  useHistory as useInboxHistory,
} from "../../../shell/renderer/desktop/connection/waiting/history.ts";
export {
  type CardView,
  cardOf,
} from "../../../shell/renderer/desktop/connection/waiting/model.ts";
export type { PairFailure } from "../pairing/pair.ts";
export type {
  ComputerItem,
  ComputerPath,
  ComputerStatus,
  Computers,
} from "./computers.ts";
export type { CodingActions, CodingTarget } from "./coding.ts";
export type { CodingSession } from "../../../protocol/coding-agent/relay.ts";
export {
  type ComputersView,
  type CodingSessionsView,
  type Conversation,
  type ConversationTarget,
  DataProvider,
  type Inbox,
  useComputers,
  useConversation,
  useCodingActions,
  useCodingSessions,
  useCurrentComputer,
  useInbox,
  useNames,
  useSampleConversation,
  useStartSession,
  useTerminal,
  useWorkspaces,
  type TerminalView,
} from "./hooks.tsx";
export type {
  TerminalLine,
  TerminalRun,
  TerminalSnapshot,
} from "./terminal.ts";
export {
  ATTACH_MAX_MB,
  type Attached,
  type Candidate,
  readCandidates,
  type Refusal,
  uploadAttached,
  withAttached,
} from "./attach.ts";
export type { ComputerData, SampleConversation } from "./link.ts";
export { callOnce, createPhoneComputers } from "./phone.ts";
export * from "./apps.ts";
export * from "./local-apps.ts";
export * from "./ops.ts";
export * from "./places.ts";
export * from "./search.ts";
export { sessionIn, toneOf } from "./workspaces.ts";
export type {
  SessionGroup,
  SessionRow,
  SessionStatus,
  WaitingFor,
  Who,
  WorkspaceIcon,
  WorkspaceView,
} from "./workspaces.ts";
