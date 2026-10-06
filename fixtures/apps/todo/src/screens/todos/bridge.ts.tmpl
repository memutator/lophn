// 화면이 앱 command를 부르는 유일한 통로. lophn의 앱 preload가 `window.lophnApp`을 주고, command는
// 이 view의 고정 blueprint에 선언한 key뿐이다. 화면은 앱 socket·credential을 알지 못한다.
export type Todo = {
  id: number;
  title: string;
  done: boolean;
  created_at: string;
  completed_at: string | null;
  due: string | null;
  hints: string[];
};

type Input = { [key: string]: string | number | boolean };

type LophnApp = {
  call(command: string, input: Input | null): Promise<unknown>;
};

function bridge(): LophnApp {
  const app = (globalThis as { lophnApp?: LophnApp }).lophnApp;
  if (!app) throw new Error("lophnApp is not available");
  return app;
}

// 화면이 받는 값은 앱 응답 전체 `{result: {result, revert?}, invocation?, mode}`다. 업무 값은 안쪽 result다.
async function call<T>(command: string, input: Input | null): Promise<T> {
  const body = await bridge().call(command, input) as {
    result?: { result?: T };
  };
  return body.result?.result as T;
}

export async function listTodos(): Promise<Todo[]> {
  const result = await call<{ rows?: Todo[] }>("list_todos", null);
  return result?.rows ?? [];
}

export async function addTodo(
  title: string,
  privateNote: string,
  due: string,
): Promise<void> {
  await call("add_todo", {
    title,
    ...(privateNote === "" ? {} : { private_note: privateNote }),
    ...(due === "" ? {} : { due }),
  });
}

export async function completeTodo(id: number): Promise<void> {
  await call("complete_todo", { id });
}

export async function exportMarkdown(file: string): Promise<void> {
  await call("export_markdown", { file });
}

export async function importMarkdown(file: string): Promise<number> {
  const result = await call<{ added?: number }>("import_markdown", { file });
  return result?.added ?? 0;
}

export async function addToCalendar(id: number): Promise<void> {
  await call("add_to_calendar", { id });
}

// agent가 고치는 중인 할 일을 볼 수 있게 이 화면이 지금 고치는 할 일을 알린다. view session은 lophn이 이
// 화면에 주는 값이다. 주지 않는 곳에서는 알리지 않는다(agent는 이 화면의 상태를 읽지 못한다).
export async function editTodo(id: number | null): Promise<void> {
  const view = new URLSearchParams(globalThis.location?.search ?? "").get(
    "view_session",
  );
  if (view === null) return;
  await call(
    "edit_todo",
    id === null ? { view_session: view } : { view_session: view, todo: id },
  );
}
