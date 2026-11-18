import { useCallback, useEffect, useRef, useState } from "react";

// 앱 view preload bridge `lophnApp.projects`의 SDK 쪽 사본(protocol/shell/app-bridge-types.ts).

/**
 * lophn project. 앱은 project를 따로 만들지 않고 자기 data를 project에 붙인다. key는 `identity ?? id`다: 다른 기계로
 * 따라가는 data는 `identity`로 붙어야 그 기계의 같은 project에 닿는다.
 */
export interface Project {
  /** 이 기계에서만 뜻이 있는 id. */
  id: string;
  /**
   * 어느 기계에서도 같은 project를 가리키는 id. git project를 아직 다른 기계와 나누지 않았으면 null이다(사람이 project
   * 상세의 Other computers에서 켠다).
   */
  identity: string | null;
  /**
   * 이 project가 전에 가졌던 `identity`(오래된 것이 앞). 사람이 project를 다른 기계의 project와 잇거나 나누면
   * `identity`가 바뀐다. 이 id로 붙은 줄은 `identity`로 옮긴다.
   */
  formerIdentities: string[];
  /** agent 주소(`workspace: {project: name}`)에 쓰는 slug. */
  name: string;
  /** 사람에게 보이는 이름. */
  title: string;
  purpose: string;
  status: "active" | "archived";
}

export interface ProjectsBridge {
  projects: {
    list(): Promise<
      | { ok: true; value: { projects: Project[] } }
      | { ok: false; error: { code: string; message: string } }
    >;
  };
}

function projectsBridge(): ProjectsBridge | undefined {
  const app = (globalThis as { lophnApp?: Partial<ProjectsBridge> }).lophnApp;
  return app?.projects === undefined ? undefined : (app as ProjectsBridge);
}

export type ProjectsState =
  | { status: "loading" }
  | { status: "ready"; projects: Project[] }
  | { status: "failed"; code: string };

export interface UseProjects {
  state: ProjectsState;
  /** 다시 읽는다. 읽는 동안 state는 이전 값 그대로다. */
  reload: () => void;
}

/**
 * lophn의 모든 project(보관 포함)를 화면이 열릴 때 한 번 읽는다. 열려 있는 동안 바뀐 것은 `reload`로 다시 읽는다.
 * 앱 view 밖이거나 이 기능이 없는 lophn이면 `failed`(`unavailable`)다.
 */
export function useProjects(
  app: ProjectsBridge | undefined = projectsBridge(),
): UseProjects {
  const [state, setState] = useState<ProjectsState>({ status: "loading" });
  const [round, setRound] = useState(0);
  const latest = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: round는 다시 읽기 신호다.
  useEffect(() => {
    const mine = ++latest.current;
    if (app === undefined) {
      setState({ status: "failed", code: "unavailable" });
      return;
    }
    void app.projects
      .list()
      .catch(() => ({ ok: false as const, error: { code: "unavailable" } }))
      .then((reply) => {
        if (mine !== latest.current) return;
        setState(
          reply.ok
            ? { status: "ready", projects: reply.value.projects }
            : { status: "failed", code: reply.error.code },
        );
      });
  }, [app, round]);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { state, reload };
}
