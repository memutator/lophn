// agent가 보는 화면 상태와 힌트 자리(apps/agent-context#R1–R5). 선언은 blueprint의 agent_context이고 이 파일은
// 그 선언의 read·write handler를 SDK로 등록한다. 요약 크기·민감 칸 제거·닫힌 view 거절·revision 충돌 검사는
// lophn(host)과 SDK가 하고, 이 앱은 view session마다 지금 고치는 할 일만 안다.
import {
  CommandRejection,
  registerAnnotationTarget,
  registerScreenContext,
} from "@lophn/cap-schedule";
import { type Deps, withStore } from "./deps.ts";
import { addHint, getTodo, privateNote, todoRevision } from "./todos.ts";

export const SCREEN = "todos";
export const READ_COMMAND = "todo_context";
export const HINT_COMMAND = "hint_todo";
export const HINT_TARGET = "hint";

// 화면이 지금 고치는 할 일을 알린다. todo를 빼면 고치는 일을 마친 것이다.
export function editTodoHandler(deps: Deps) {
  return async (input: unknown) => {
    const { view_session, todo } = input as {
      view_session: string;
      todo?: number;
    };
    if (todo !== undefined) {
      const found = await withStore(
        deps,
        "edit_todo",
        (store) => getTodo(store, todo),
      );
      if (found === undefined) {
        throw new CommandRejection("invalid_input", "the todo does not exist");
      }
    }
    deps.views.set(view_session, { todo: todo ?? null });
    return { editing: todo ?? null };
  };
}

export function registerTodoContext(deps: Deps): void {
  registerScreenContext({
    screen: SCREEN,
    command: READ_COMMAND,
    // 이 앱이 모르는 view session은 undefined다. 닫힌 view는 runtime이 먼저 막는다.
    read: async ({ view_session, detail }) => {
      const view = deps.views.get(view_session);
      if (view === undefined) return undefined;
      if (view.todo === null) {
        return { revision: "none", summary: "No todo is being edited." };
      }
      const id = view.todo;
      return await withStore(deps, READ_COMMAND, (store) => {
        const todo = getTodo(store, id);
        const revision = todoRevision(store, id);
        if (todo === undefined) {
          return { revision, summary: "The todo being edited was removed." };
        }
        const { hints, ...row } = todo;
        const state = todo.done ? "done" : "open";
        const due = todo.due === null ? "" : `, due ${todo.due}`;
        return {
          revision,
          summary:
            `Editing todo #${id} "${todo.title}" (${state}${due}) with ${hints.length} hints.`,
          // private_note는 선언한 민감 칸이다. host가 sensitive_paths로 상세에서 지운다.
          ...(detail
            ? {
              data: {
                todo: { ...row, private_note: privateNote(store, id) },
                hints,
              },
            }
            : {}),
        };
      });
    },
  });
  registerAnnotationTarget({
    screen: SCREEN,
    target: HINT_TARGET,
    command: HINT_COMMAND,
    write: async ({ view_session, text }) => {
      const id = deps.views.get(view_session)?.todo;
      if (id === null || id === undefined) {
        throw new CommandRejection(
          "invalid_input",
          "no todo is being edited in this view",
        );
      }
      return await withStore(deps, HINT_COMMAND, (store) => {
        addHint(store, id, text, deps.now());
        return { revision: todoRevision(store, id), result: { todo: id } };
      });
    },
  });
}
