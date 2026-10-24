// navigation: 화면 안에서 오가는 control.
// 탭 묶음의 root. 한 화면 안의 같은 층 보기를 오갈 때 쓴다. 본문은 두고 거르는 값만 바꾸면 SegmentedControl이다. 작업대 문서 탭은 shell이 따로 둔다.
export { Tabs, type TabsProps } from "./tabs/tabs.tsx";
// Tab들을 한 줄로 묶는다. Tabs 바로 안에 한 번 둔다.
export { TabList } from "./tabs/tabs.tsx";
// 탭 머리 하나. value가 같은 TabPanel을 보인다.
export { Tab, type TabProps } from "./tabs/tabs.tsx";
// 탭 하나의 내용. value가 고른 탭과 같을 때만 보인다.
export { TabPanel } from "./tabs/tabs.tsx";
// 앱 화면 사이를 오가는 목록. AppShell의 nav에 두고 좁은 영역에서는 가로 한 줄이 된다. 한 화면 안의 보기 전환은 Tabs다.
export {
  Sidebar,
  type SidebarItem,
  type SidebarProps,
} from "./sidebar/sidebar.tsx";
