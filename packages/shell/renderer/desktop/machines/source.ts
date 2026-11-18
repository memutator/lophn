// 다른 기계를 보는 화면이 읽는 통로. 화면은 이 interface만 보고, 실제 통로(shell main의 `lophnMachines`)는 따로 짓는다.
import type { SourceResult } from "../../source-result.ts";

export type { SourceResult };

export type MachineStatus =
  | "connecting"
  | "connected"
  | "offline"
  | "update"
  | "removed";

/** 명단의 다른 컴퓨터 하나. removed는 보던 기계가 명단에서 빠졌다(목록에는 없다). */
export interface MachineItem {
  readonly id: string;
  /** 명단의 이름. 모든 기계에 같다. */
  readonly name: string;
  readonly status: MachineStatus;
  /** status가 update일 때 올려야 하는 쪽: client는 이 컴퓨터의 lophn, host는 그 기계의 lophn. 그 밖에는 null이다. */
  readonly update: "client" | "host" | null;
  /** 연결된 길. 연결되지 않았으면 null이다. */
  readonly path: "direct" | "relay" | null;
  /** 마지막으로 본 때(ISO). 한 번도 못 봤으면 null이다. */
  readonly lastSeenAt: string | null;
}

export interface MachinesView {
  /** starting은 이 컴퓨터의 id나 core의 기계 목록을 아직 모른다. */
  readonly state: "starting" | "ready";
  readonly thisComputer: { readonly id: string; readonly name: string } | null;
  readonly machines: readonly MachineItem[];
}

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
  /** 다른 기계의 project를 이 컴퓨터에 clone한다(목록의 [Clone here]). */
  cloneHere(input: {
    readonly url: string;
    readonly identity: string;
    readonly title: string;
  }): Promise<CloneHereOutcome>;
}
