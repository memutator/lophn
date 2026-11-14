// settings 화면 gallery·mock의 가짜 core. 화면은 useCoreRead로 읽으므로 가짜 통로들은 읽기 답을 여기 두고,
// 쓰면 이 상태를 바꾼 뒤 붙은 FakeSource로 StateChanged를 내 화면이 다시 읽게 한다. 선언한 설정은 한 저장소라
// 여러 항목의 가짜 통로가 같은 `settings/list` 답을 나눠 쓴다.
import { settingsList } from "../../../../../protocol/config/file.ts";
import type { ChangeName } from "../../../../../protocol/events/changes.ts";
import { projectApi } from "../../../../../protocol/projects/project-api.ts";
import { secretStatus } from "../../../../../protocol/secrets/secret-file.ts";
import {
  type FakeAnswer,
  fakeAnswer,
  type FakeSource,
} from "../../connection/events/fake-source.ts";
import { PROJECT_GROCERY, PROJECT_OFFICE } from "../../dev-mock/ids.ts";
import type { SettingFolderView } from "../declared.ts";
import type { SettingEntry } from "../source.ts";

export interface FakeCore {
  /** FakeSource의 answers에 넘긴다. 같은 route는 앞에 더한 답이 이긴다. */
  readonly answers: FakeAnswer[];
  /** 가짜 쓰기 뒤 부른다. 붙은 FakeSource가 있으면 그 이름의 StateChanged를 낸다. */
  changed(...names: ChangeName[]): void;
  /** answers로 FakeSource를 만든 뒤 붙인다. */
  attach(source: FakeSource): void;
  /** 선언을 더한다. 같은 key는 바꾼다. */
  declare(entries: readonly SettingEntry[]): void;
  /** 사람이 정한 값을 쓴다. 선언이 없는 key면 기본값 없는 선언을 더한다. */
  set(key: string, value: unknown): void;
  unset(key: string): void;
  folder(key: string, view: SettingFolderView): void;
  /** 이 이름의 secret 값이 있다고 답한다(`secrets/status`). */
  secret(name: string, configured: boolean): void;
}

/** 화면 확인용 project 둘. shell rules와 호출 정책이 이름을 읽는다. */
export const FAKE_PROJECTS: readonly { id: string; title: string }[] = [
  { id: PROJECT_GROCERY, title: "Grocery budget" },
  { id: PROJECT_OFFICE, title: "Home office" },
];

const COMMON = { as_of_seq: "0", next_cursor: null };

export function fakeCore(): FakeCore {
  const entries = new Map<string, SettingEntry>();
  const folders = new Map<string, SettingFolderView>();
  const secrets = new Map<string, boolean>();
  let source: FakeSource | null = null;
  const answers: FakeAnswer[] = [
    fakeAnswer(settingsList, (input) => {
      const wanted = (key: string) =>
        input.keys === undefined || input.keys.includes(key);
      return {
        settings: [...entries.values()]
          .filter((entry) => wanted(entry.key))
          .map((entry) => ({
            key: entry.key,
            description: "",
            type: entry.type as never,
            ...(entry.hasDefault
              ? { default: entry.defaultValue as never }
              : {}),
            ...(entry.hasChosen ? { chosen: entry.chosen as never } : {}),
          })),
        folders: [...folders.entries()]
          .filter(([key]) => wanted(key))
          .map(([key, view]) => ({
            key,
            description: "",
            folder: key,
            type: {},
            entries: view.entries.map((one) => ({
              id: one.id,
              value: one.value as never,
            })),
            unreadable: [...view.unreadable],
          })),
      };
    }),
    fakeAnswer(secretStatus, (input) => ({
      secrets: (input.names ?? [...secrets.keys()]).map((name) => ({
        name,
        configured: secrets.get(name) === true,
      })),
    })),
    fakeAnswer(projectApi.list, {
      ...COMMON,
      projects: FAKE_PROJECTS.map((project) => ({
        id: project.id,
        name: project.title.toLowerCase().replace(/\W+/g, "-"),
        title: project.title,
        purpose: "",
        revision: "1",
        status: "active" as const,
        folders: [],
      })),
    } as never),
  ];
  const core: FakeCore = {
    answers,
    changed(...names) {
      source?.emitEvent({
        type: "StateChanged",
        subject: null,
        at: new Date().toISOString(),
        payload: { changes: names.map((name) => ({ name, id: null })) },
      });
    },
    attach(next) {
      source = next;
    },
    declare(list) {
      for (const entry of list) entries.set(entry.key, entry);
    },
    set(key, value) {
      const entry = entries.get(key);
      entries.set(key, {
        key,
        type: entry?.type ?? {},
        hasDefault: entry?.hasDefault ?? false,
        defaultValue: entry?.defaultValue,
        hasChosen: true,
        chosen: value,
      });
    },
    unset(key) {
      const entry = entries.get(key);
      if (entry !== undefined) {
        entries.set(key, { ...entry, hasChosen: false, chosen: undefined });
      }
    },
    folder(key, view) {
      folders.set(key, view);
    },
    secret(name, configured) {
      secrets.set(name, configured);
    },
  };
  return core;
}
