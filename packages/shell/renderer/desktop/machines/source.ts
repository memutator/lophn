// 다른 기계를 보는 화면이 읽고 쓰는 통로. 화면은 이 interface만 보고, 실제 통로(shell main의 `lophnMachines`)는 따로 짓는다.
import type { SourceResult } from "../../source-result.ts";

export type { SourceResult };

export type MachineStatus = "connecting" | "connected" | "offline" | "removed";

/** 짝지은 기계 하나. */
export interface MachineItem {
  readonly id: string;
  /** 보이는 이름: 별명이 있으면 별명, 없으면 그 기계가 알린 이름. */
  readonly name: string;
  /** 그 기계가 알린 이름. */
  readonly announcedName: string | null;
  /** 사람이 붙인 별명. 없으면 null이다. */
  readonly alias: string | null;
  readonly status: MachineStatus;
  /** 연결된 길. 연결되지 않았으면 null이다. */
  readonly path: "direct" | "relay" | null;
  /** 마지막으로 본 때(ISO). 한 번도 못 봤으면 null이다. */
  readonly lastSeenAt: string | null;
}

export interface MachinesView {
  /** starting은 이 컴퓨터의 id를 아직 모른다. unreadable은 저장 file을 못 읽었다(덮지 않고 기계 보기를 끈다). */
  readonly state: "starting" | "ready" | "unreadable";
  readonly thisComputer: { readonly id: string; readonly name: string } | null;
  readonly machines: readonly MachineItem[];
  /** 시작 때 여는 기계. last는 연결된 채 focus를 받은 마지막 창의 기계다. */
  readonly start:
    | { readonly mode: "last" }
    | { readonly mode: "machine"; readonly machine: string };
  readonly last: string | null;
}

export type PairOutcome =
  | { readonly ok: true; readonly machine: string }
  | {
      readonly ok: false;
      readonly reason:
        | "invalid_text"
        | "unreachable"
        | "refused"
        | "expired"
        | "closed"
        | "this_computer"
        | "unavailable";
    };

/** The result of cloning another machine's project onto this computer. */
export type CloneHereOutcome =
  | { readonly ok: true; readonly path: string }
  /** No projects folder and the person closed the folder picker. */
  | { readonly ok: false; readonly reason: "cancelled" }
  /** This computer's git has no credentials for it; the person runs `command` in a terminal here. */
  | {
      readonly ok: false;
      readonly reason: "git_auth";
      readonly command: string;
    }
  | { readonly ok: false; readonly reason: "failed"; readonly message: string };

export interface MachinesSource {
  /** 지금 목록. 바뀌지 않았으면 같은 값을 돌려준다(useSyncExternalStore가 비교한다). */
  get(): MachinesView;
  subscribe(listener: () => void): () => void;
  /** 이 창이 보는 기계. null이면 이 컴퓨터의 창이다. */
  thisWindow(): { readonly id: string; readonly name: string } | null;
  /** 붙여 넣은 pairing text로 짝짓는다. */
  pair(text: string): Promise<PairOutcome>;
  remove(id: string): Promise<SourceResult<void>>;
  /** 별명을 둔다. null이면 별명을 지워 알린 이름이 다시 보인다. */
  rename(id: string, alias: string | null): Promise<SourceResult<void>>;
  setStart(start: MachinesView["start"]): Promise<SourceResult<void>>;
  /** 그 기계의 창을 열거나 앞으로 가져온다. 이 컴퓨터의 id면 이 컴퓨터의 창이다. */
  open(id: string): Promise<SourceResult<void>>;
  /** 다른 기계의 창에서 이 컴퓨터의 core를 읽는다. 이 두 read만 된다. */
  thisRead(
    route: "project.list" | "ListSessions",
    input: unknown,
  ): Promise<SourceResult<unknown>>;
  /** 다른 기계의 창에서 그 기계의 project를 이 컴퓨터에 clone한다. */
  cloneHere(input: {
    readonly url: string;
    readonly identity: string;
    readonly title: string;
  }): Promise<CloneHereOutcome>;
}
