// blueprint에 선언한 command의 handler. 선언한 key와 등록한 handler가 같아야 준비가 끝난다.
import {
  command,
  CommandRejection,
  currentContext,
  readResult,
  withRevert,
} from "@lophn/cap-schedule";
import { addCalendarEvent } from "./calendar.ts";
import { editTodoHandler, registerTodoContext } from "./context.ts";
import { defaults, type Deps, fileFailure, withStore } from "./deps.ts";
import {
  addTodo,
  completeTodo,
  getTodo,
  importTodos,
  listTodos,
  parseMarkdown,
  revertChange,
  type RevertInput,
  toMarkdown,
} from "./todos.ts";

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.md$/;

function invocation(): string | null {
  return currentContext()?.invocation ?? null;
}

function fileName(input: unknown): string {
  const name = (input as { file?: unknown } | null)?.file;
  if (typeof name !== "string" || !FILE_NAME.test(name)) {
    throw new CommandRejection(
      "invalid_input",
      "the file name must be a plain Markdown file name",
    );
  }
  return name;
}

export function listTodosHandler(deps: Deps = defaults) {
  return () =>
    withStore(
      deps,
      "list_todos",
      (store) =>
        readResult(listTodos(store), {
          coverage: "complete",
          freshness: "fresh",
        }),
    );
}

export function addTodoHandler(deps: Deps = defaults) {
  return async (input: unknown) => {
    const value = input as {
      title?: unknown;
      private_note?: unknown;
      due?: unknown;
    } | null;
    const title = String(value?.title ?? "").trim();
    if (title === "") {
      throw new CommandRejection("invalid_input", "the todo title is empty");
    }
    const added = await withStore(
      deps,
      "add_todo",
      (store) =>
        addTodo(
          store,
          {
            title,
            private_note: String(value?.private_note ?? ""),
            due: typeof value?.due === "string" ? value.due : null,
          },
          deps.now(),
          invocation(),
        ),
    );
    return withRevert(added.todo, added.change);
  };
}

export function completeTodoHandler(deps: Deps = defaults) {
  return async (input: unknown) => {
    const id = (input as { id: number }).id;
    const done = await withStore(
      deps,
      "complete_todo",
      (store) => completeTodo(store, id, deps.now(), invocation()),
    );
    return withRevert(done.todo, done.change);
  };
}

export function revertTodoHandler(deps: Deps = defaults) {
  return (input: unknown) =>
    withStore(
      deps,
      "revert_todo",
      (store) => revertChange(store, input as RevertInput),
    );
}

export function exportMarkdownHandler(deps: Deps = defaults) {
  return async (input: unknown) => {
    const name = fileName(input);
    const todos = await withStore(deps, "export_markdown", listTodos);
    const path = `${deps.dirs.export}/${name}`;
    try {
      await deps.files.writeText(path, toMarkdown(todos));
    } catch (error) {
      fileFailure(error, "export_markdown");
    }
    return { file: name, count: todos.length };
  };
}

export function importMarkdownHandler(deps: Deps = defaults) {
  return async (input: unknown) => {
    const name = fileName(input);
    let text: string;
    try {
      text = await deps.files.readText(`${deps.dirs.import}/${name}`);
    } catch (error) {
      fileFailure(error, "import_markdown");
    }
    const items = parseMarkdown(text);
    return await withStore(
      deps,
      "import_markdown",
      (store) => importTodos(store, items, deps.now(), invocation()),
    );
  };
}

export function addToCalendarHandler(deps: Deps = defaults) {
  return async (input: unknown) => {
    const { id, starts_at } = input as { id: number; starts_at?: string };
    const todo = await withStore(
      deps,
      "add_to_calendar",
      (store) => getTodo(store, id),
    );
    if (todo === undefined) {
      throw new CommandRejection("invalid_input", "the todo does not exist");
    }
    const startsAt = starts_at ?? todo.due;
    if (startsAt === null) {
      throw new CommandRejection(
        "invalid_input",
        "the todo has no due date; give a start time",
      );
    }
    const event = await addCalendarEvent({
      title: todo.title,
      starts_at: startsAt,
    });
    return { requested: true, event };
  };
}

export function registerCommands(deps: Deps = defaults): void {
  command("list_todos", listTodosHandler(deps));
  command("add_todo", addTodoHandler(deps));
  command("complete_todo", completeTodoHandler(deps));
  command("revert_todo", revertTodoHandler(deps));
  command("export_markdown", exportMarkdownHandler(deps));
  command("import_markdown", importMarkdownHandler(deps));
  command("add_to_calendar", addToCalendarHandler(deps));
  command("edit_todo", editTodoHandler(deps));
  registerTodoContext(deps);
}
