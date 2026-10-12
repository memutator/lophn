// 앱 shell·tab·sidebar·grid·card와 5가지 페이지 틀. 모두 창이 아니라 넣은 영역의 폭에 반응하고
// 패널 320px·카드 240px부터 페이지 가로 scroll이 없다. 탭·카드·페이지 틀은 lophn 화면과 같은 component다.
export {
  AppShell,
  type AppShellProps,
  Grid,
  type GridProps,
  Sidebar,
  type SidebarItem,
  type SidebarProps,
  useContainerSpace,
} from "./app-shell.tsx";
export { type ContainerSpace, containerSpace } from "./space.ts";
export {
  Card,
  type CardProps,
  DashboardCell,
  DashboardFrame,
  type DashboardSpan,
  FormFrame,
  List,
  ListDetailFrame,
  type ListDetailFrameProps,
  ListItem,
  type ListItemProps,
  READING_WIDTHS,
  ReadingFrame,
  type ReadingFrameProps,
  type ReadingWidth,
  Tab,
  TableFrame,
  TabList,
  TabPanel,
  type TabProps,
  Tabs,
  type TabsProps,
} from "@lophn/design/components";
