// 탭 주인 gallery의 고정 값: 탭을 연 agent session 둘(이름과 얼굴), browser profile 하나, shell 틀 page의 어느 탭이 누구의 것인지.
// 앱에서는 session 목록과 agent 목록이 주인을 정한다. gallery는 `OwnerProvider`에 이 표를 준다.
import type { BrowserProfile } from "../../../packages/protocol/shell/browser-profiles.ts";
import type {
  Owner,
  OwnerLookup,
} from "../../../packages/shell/renderer/parts/agent-session/owner.tsx";
import type { TabItem } from "../../../packages/shell/renderer/shell/desk-model.ts";
import type { MockTab } from "./shell-data.tsx";

export const RESEARCHER = "ses_01h455vb4pex5v6nkc6gd5tw01";
export const REVIEWER = "ses_01h455vb4pex5v6nkc6gd5tw02";

const OWNERS: Readonly<Record<string, Owner>> = {
  [RESEARCHER]: {
    name: "Researcher",
    face: {
      kind: "lophn",
      avatar: { kind: "character", shape: "round", color: "teal" },
    },
  },
  [REVIEWER]: {
    name: "Reviewer",
    face: {
      kind: "lophn",
      avatar: { kind: "character", shape: "pear", color: "lavender" },
    },
  },
};

export const mockOwners: OwnerLookup = (session) => OWNERS[session];

/** 사람이 만든 profile 하나. 기본 profile은 목록에 없다. */
export const WORK_PROFILE: BrowserProfile = {
  id: "bpf_01h455vb4pex5v6nkc6gd5pf01",
  name: "Work",
  color: "periwinkle",
};

/** shell 틀 page의 탭 key → 주인과 profile. 표에 없는 탭은 사람이 연 기본 profile 탭이다. */
export const TAB_MARKS: Readonly<
  Record<string, { readonly owner?: string; readonly profile?: BrowserProfile }>
> = {
  c1: { owner: RESEARCHER },
  p2: { owner: RESEARCHER },
  dev: { owner: REVIEWER },
  "o-pulls": { owner: RESEARCHER, profile: WORK_PROFILE },
  "o-notes": { owner: RESEARCHER },
  "o-check": { owner: REVIEWER },
  "g-inbox": { owner: RESEARCHER },
  "g-pulls": { owner: RESEARCHER, profile: WORK_PROFILE },
  "o-board": { owner: REVIEWER, profile: WORK_PROFILE },
};

// shell 틀 mock의 탭 값(shell-data.tsx의 itemOf와 같은 모양): 그림 값은 `fields.mock`에 있다.
const itemOf = (tab: MockTab): TabItem => ({
  key: tab.key,
  kind: "mock",
  title: tab.title,
  fields: { mock: tab },
});

/** agent(Reviewer)가 Work profile로 연 browser 탭. Main desk의 탭 줄 끝에 선다. */
export const OWNED_TAB: TabItem = itemOf({
  key: "o-board",
  kind: "file",
  title: "Sprint board",
  crumbs: ["linear.app", "Sprint board"],
});

/** agent가 연 접힌 float. Researcher 둘, Reviewer 하나. */
export const OWNED_FLOATS: readonly TabItem[] = (
  [
    {
      key: "o-pulls",
      kind: "file",
      title: "Pull requests",
      crumbs: ["github.com", "Pull requests"],
    },
    {
      key: "o-notes",
      kind: "file",
      title: "gaze-notes.md",
      crumbs: ["phroner", "gaze-notes.md"],
    },
    {
      key: "o-check",
      kind: "terminal",
      title: "npm test",
      crumbs: ["phroner", "npm test"],
    },
  ] satisfies MockTab[]
).map(itemOf);

/** 모든 workspace에 사는 Researcher의 접힌 float. desk float과 같은 chip에 묶인다. */
export const OWNED_GLOBAL: TabItem = itemOf({
  key: "g-pulls",
  kind: "file",
  title: "Issues",
  crumbs: ["github.com", "Issues"],
});
