// @lophn/ui-native: the phone UI kit. The React Native counterpart of @lophn/ui, drawn from the same tokens and
// shaped after the approved phone wireframes (tools/wireframes/drafts/phone/). Faces (agent characters, vendor icons)
// are not part of the kit; every place that shows one takes it as a ReactNode.

// ── root and theme ──
// Mount once at the root of the app: safe area, keyboard and theme.
export { UiProvider, type UiProviderProps } from "./provider.tsx";
// Switch light and dark for a subtree (a gallery, a preview); UiProvider already has one.
export { ThemeProvider, type ThemeProviderProps } from "./theme.tsx";
// Read colors, type steps and shadows when a kit part does not fit: a screen's own layout.
export {
  useTheme,
  themes,
  type Theme,
  type Scheme,
  type TypeName,
} from "./theme.tsx";
// Give text and icons below a color without naming it on each (like CSS currentColor).
export { Ink } from "./theme.tsx";

// ── primitives ──
// Every piece of text on the phone: picks a type step, a tone and a weight in Pretendard or JetBrains Mono.
export { Text, type TextProps, type TextTone } from "./primitives/text.tsx";
// A Lucide icon at the phone's 1.6 stroke.
export { Icon, type IconProps } from "./primitives/icon.tsx";
// An action shown as an icon alone in a 44 round target: top bar buttons, search, +.
export { IconButton, type IconButtonProps } from "./primitives/icon-button.tsx";
// A labelled action: primary, secondary, ghost or danger, in sm, md or lg.
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from "./primitives/button.tsx";

// ── frame ──
// One screen: safe area, a top bar, a body, and a footer that rides up on the keyboard.
export { Screen, type ScreenProps } from "./layout/screen.tsx";
// The bar at the top of every screen: menu, back or close, a title with its quieter part, and actions.
export { TopBar, type TopBarProps } from "./layout/screen.tsx";
// A section's name above its rows, with an optional link at the end.
export { Label, type LabelProps } from "./layout/list.tsx";
// One line of a list: a session, a computer, a setting, a menu choice.
export { Row, type RowProps } from "./layout/list.tsx";
// A hairline between rows, lined up with their text.
export { Divider, type DividerProps } from "./layout/list.tsx";
// A full-width band that starts a kind of item in a long list.
export { Band, type BandProps } from "./layout/list.tsx";
// A rounded box that holds one thing: a waiting request, a note.
export { Card, type CardProps } from "./layout/surface.tsx";
// A quiet white box with a faint edge: a numbered list.
export { Plain, type PlainProps } from "./layout/surface.tsx";
// Settings rows in a card on a floor screen.
export { Group, type GroupProps } from "./layout/surface.tsx";
// Rows in a card inside an app's own layout.
export { ListCard, type ListCardProps } from "./layout/surface.tsx";
// A state of the whole screen said at its top (the computer is offline).
export { Banner, type BannerProps } from "./feedback/notice.tsx";
// A short note floating above the bottom edge (Updated to Release 8).
export { Toast, type ToastProps } from "./feedback/notice.tsx";
// The one main action of a list screen, floating at the bottom right.
export { Fab, type FabProps } from "./feedback/notice.tsx";

// ── display ──
// A session's or a computer's state as a small dot.
export { Dot, type DotProps, type DotTone } from "./feedback/status.tsx";
// How many things wait.
export { Badge, type BadgeProps } from "./feedback/status.tsx";
// A short quiet word next to a name.
export { Tag, type TagProps } from "./feedback/status.tsx";
// A state said with its status icon and word.
export {
  STATUS_ICONS,
  StatusMark,
  type StatusMarkProps,
} from "./feedback/status.tsx";
// A project's or an app's colored mark.
export { Mark, type MarkProps, type MarkTone } from "./feedback/display.tsx";
// A command, a path or a short output in a mono box.
export { Pre, type PreProps } from "./feedback/display.tsx";
// A label over a large number.
export { Stat, type StatProps } from "./feedback/display.tsx";

// ── input ──
// A label over one control, with a hint under it.
export { Field, type FieldProps } from "./input/input.tsx";
// A one-line text box; soft for search.
export { Input, type InputProps } from "./input/input.tsx";
// Turns one setting on or off right away.
export { Switch, type SwitchProps } from "./input/choice.tsx";
// The mark of a pick-one choice inside a pressable row.
export { Radio, type RadioProps } from "./input/choice.tsx";
// The mark of a pick-many choice inside a pressable row.
export { Checkbox, type CheckboxProps } from "./input/choice.tsx";
// Underlined tabs across the top of a place.
export { Tabs, type TabsProps } from "./input/choice.tsx";
// A pick-one of a few short choices side by side.
export {
  SegmentedControl,
  type SegmentedControlProps,
} from "./input/choice.tsx";
// Pills that narrow a list.
export { FilterChips, type FilterChipsProps } from "./input/choice.tsx";
// A quiet pick in the composer's bottom row (model, workspace) that opens a sheet.
export { Chip, type ChipProps } from "./input/choice.tsx";
// An outlined pick with a chevron: the computer in the top bar, the workspace of a new session.
export { Pill, type PillProps } from "./input/choice.tsx";

// ── overlay ──
// Anything that rises from the bottom: a menu, a picker, a short form. Closes by dragging down.
export { Sheet, type SheetProps } from "./overlay/sheet.tsx";
// A list of actions in a sheet; choosing one closes it.
export { Menu, type MenuItem, type MenuProps } from "./overlay/sheet.tsx";

// ── sidebar ──
// The sidebar's panel, sliding in from the left over a scrim.
export { Drawer, type DrawerProps } from "./navigation/sidebar.tsx";
// The sidebar's top line: the product's face, its name, search.
export { SidebarHead, type SidebarHeadProps } from "./navigation/sidebar.tsx";
// The computer the sidebar belongs to; opens the list of computers.
export {
  ComputerPicker,
  type ComputerPickerProps,
} from "./navigation/sidebar.tsx";
// A top-level place: Inbox, Jobs, Agents, Settings.
export { NavRow, type NavRowProps } from "./navigation/sidebar.tsx";
// A workspace: Home, a project, an app.
export { WorkspaceRow, type WorkspaceRowProps } from "./navigation/sidebar.tsx";
// A session under its workspace, with its state dot.
export { SessionRow, type SessionRowProps } from "./navigation/sidebar.tsx";
// A group's name: Workspaces.
export { SidebarLabel, type SidebarLabelProps } from "./navigation/sidebar.tsx";
// A worktree's name over its sessions.
export {
  WorktreeLabel,
  type WorktreeLabelProps,
} from "./navigation/sidebar.tsx";
// The sidebar's scrolling middle, fading out at the bottom.
export { SidebarList, type SidebarListProps } from "./navigation/sidebar.tsx";
// The sidebar's bottom line: Settings.
export { SidebarFoot, type SidebarFootProps } from "./navigation/sidebar.tsx";

// ── conversation ──
// What the person said, on the right, with an optional note under it.
export { UserBubble, type UserBubbleProps } from "./conversation/message.tsx";
// One answer from an agent under its face and name.
export { AgentTurn, type AgentTurnProps } from "./conversation/message.tsx";
// A folded line of what the agent did; opens the steps.
export { Act, type ActProps } from "./conversation/activity.tsx";
// A file the agent changed; opens the diff.
export { EditCard, type EditCardProps } from "./conversation/activity.tsx";
// The line under the last turn while the session runs or waits.
export { Working, type WorkingProps } from "./conversation/activity.tsx";
// A turn that stopped on an error, with Retry.
export { ErrorLine, type ErrorLineProps } from "./conversation/activity.tsx";
// The quiet line that ends a turn (time, copy).
export { Meta, type MetaProps } from "./conversation/activity.tsx";
// One line of a file's diff.
export { DiffLine, type DiffLineProps } from "./conversation/activity.tsx";
// The frame of anything waiting on the person above the composer (a folded todo list too).
export {
  AskCard,
  type AskCardProps,
  AskTitle,
  type AskTitleProps,
} from "./conversation/ask.tsx";
// One labelled fact of a request in a mono box.
export { Fact, type FactProps } from "./conversation/ask.tsx";
// A permission request: Deny, Always allow, Allow once.
export { ApprovalCard, type ApprovalCardProps } from "./conversation/ask.tsx";
// A question: pick an option (or several) or write an answer, one at a time.
export {
  type QuestionAnswer,
  QuestionCard,
  type QuestionCardProps,
  type QuestionOption,
} from "./conversation/ask.tsx";
// The message box at the bottom of a conversation: +, chips, send or stop.
export { Composer, type ComposerProps } from "./conversation/composer.tsx";
// A picture or a file attached in the composer.
export {
  FileChip,
  type FileChipProps,
  Thumb,
  type ThumbProps,
} from "./conversation/composer.tsx";
// The conversation itself: newest at the bottom, follows new text, a button back to the latest.
export {
  MessageList,
  type MessageListProps,
} from "./conversation/message-list.tsx";

// ── reading ──
// Markdown from the same parse as desktop: chat for answers, reading for documents.
export { Markdown, type MarkdownProps } from "./reading/markdown.tsx";
// Code in a scrolling mono box with copy.
export { CodeBlock, type CodeBlockProps } from "./reading/code-block.tsx";
