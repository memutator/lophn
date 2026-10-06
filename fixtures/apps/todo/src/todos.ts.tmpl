// 앱의 업무 규칙. DB 구조와 질의는 이 앱에 남고 SDK로 올리지 않는다(apps/sdk#R36).
import { CommandRejection } from "@lophn/cap-schedule";
import type { Migration, Store } from "@lophn/cap-store";

export type Todo = {
  id: number;
  title: string;
  done: boolean;
  created_at: string;
  completed_at: string | null;
  // schema 2부터 있는 칸이다. schema 1 DB에서는 항상 null이다.
  due: string | null;
  hints: string[];
};

export const LIST_LIMIT = 200;
// schema 2가 `due` 칸을 더했다(migrations/1-2.sql).
export const DUE_SCHEMA = 2;

const MIGRATIONS = new URL("../migrations/", import.meta.url);

// DB schema 단계다. SQL은 migrations/에 있고 공개한 단계는 고치지 않고 새 단계를 더한다. 이 앱의 release는
// 이 폴더의 파일 모음이 정하고(0→1 하나, 0→1→2 둘) 마지막 단계의 번호가 그 release의 schema다.
export function migrations(): Migration[] {
  const steps: Migration[] = [];
  for (const entry of Deno.readDirSync(MIGRATIONS)) {
    const found = /^(\d+)-(\d+)\.sql$/.exec(entry.name);
    if (!found) continue;
    steps.push({
      from: Number(found[1]),
      to: Number(found[2]),
      sql: Deno.readTextFileSync(new URL(entry.name, MIGRATIONS)),
    });
  }
  return steps.sort((left, right) => left.from - right.from);
}

export function schemaVersion(): number {
  return migrations().reduce((high, step) => Math.max(high, step.to), 0);
}

// preview·test는 여기서 schema를 맞춘다. 운영(live)은 activation 때 data worker가 이미 맞췄다.
export async function ensureSchema(store: Store): Promise<void> {
  const target = schemaVersion();
  if (store.schema() < target) {
    await store.migrate(migrations(), { target });
  }
}

type Row = Record<string, string | number | null>;

function hasDue(store: Store): boolean {
  return store.schema() >= DUE_SCHEMA;
}

function reject(code: "invalid_input" | "conflict", message: string): never {
  throw new CommandRejection(code, message);
}

function toTodo(row: Row, hints: string[]): Todo {
  return {
    id: Number(row["id"]),
    title: String(row["title"]),
    done: row["done"] === 1,
    created_at: String(row["created_at"]),
    completed_at: row["completed_at"] === null
      ? null
      : String(row["completed_at"]),
    due: row["due"] === undefined || row["due"] === null
      ? null
      : String(row["due"]),
    hints,
  };
}

function hintsOf(store: Store, id: number): string[] {
  return (store.db
    .prepare("select text from todo_hint where todo = ? order by id")
    .all(id) as Row[]).map((row) => String(row["text"]));
}

function column(store: Store): string {
  return hasDue(store) ? "due" : "null as due";
}

export function listTodos(store: Store): Todo[] {
  const rows = store.db
    .prepare(
      `select id, title, done, created_at, completed_at, ${column(store)}
         from todo order by created_at desc, id desc limit ?`,
    )
    .all(LIST_LIMIT) as Row[];
  return rows.map((row) => toTodo(row, hintsOf(store, Number(row["id"]))));
}

export function getTodo(store: Store, id: number): Todo | undefined {
  const row = store.db
    .prepare(
      `select id, title, done, created_at, completed_at, ${column(store)}
         from todo where id = ?`,
    )
    .get(id) as Row | undefined;
  return row === undefined ? undefined : toTodo(row, hintsOf(store, id));
}

// 이 앱의 revision이다. 되돌리지 않은 가장 큰 변경 번호라서 변경을 되돌리면 그 변경 전 값으로 돌아간다.
export function revisionOf(store: Store): number {
  const row = store.db
    .prepare(
      "select coalesce(max(id), 0) as revision from change where reverted = 0",
    )
    .get() as Row;
  return Number(row["revision"]);
}

export type Change = { id: number; receipt: string; revision: string };

function recorded(id: number): Change {
  return { id, receipt: `change:${id}`, revision: String(id) };
}

function record(
  store: Store,
  kind: "add" | "complete" | "import",
  todo: number | null,
  invocation: string | null,
  before: unknown,
): Change {
  const row = store.db
    .prepare(
      "insert into change (kind, todo, invocation, before) values (?, ?, ?, ?) returning id",
    )
    .get(
      kind,
      todo,
      invocation,
      before === null ? null : JSON.stringify(before),
    ) as Row;
  return recorded(Number(row["id"]));
}

export type NewTodo = {
  title: string;
  private_note: string;
  due: string | null;
};

export function addTodo(
  store: Store,
  input: NewTodo,
  now: string,
  invocation: string | null,
): { todo: Todo; change: Change } {
  if (input.due !== null && !hasDue(store)) {
    reject("invalid_input", "due dates need the newer database schema");
  }
  return store.transaction(() => {
    const row = store.db
      .prepare(
        "insert into todo (title, created_at, private_note) values (?, ?, ?) returning id",
      )
      .get(input.title, now, input.private_note) as Row;
    const id = Number(row["id"]);
    if (input.due !== null) {
      store.db.prepare("update todo set due = ? where id = ?").run(
        input.due,
        id,
      );
    }
    const change = record(store, "add", id, invocation, null);
    return { todo: getTodo(store, id)!, change };
  });
}

export function completeTodo(
  store: Store,
  id: number,
  now: string,
  invocation: string | null,
): { todo: Todo; change: Change } {
  return store.transaction(() => {
    const row = store.db
      .prepare("select done, completed_at, version from todo where id = ?")
      .get(id) as Row | undefined;
    if (row === undefined) reject("invalid_input", "the todo does not exist");
    if (row["done"] === 1) reject("conflict", "the todo is already done");
    store.db
      .prepare(
        "update todo set done = 1, completed_at = ?, version = version + 1 where id = ?",
      )
      .run(now, id);
    const change = record(store, "complete", id, invocation, {
      done: 0,
      completed_at: null,
      version: row["version"],
    });
    return { todo: getTodo(store, id)!, change };
  });
}

export type RevertInput = {
  invocation: string;
  receipt: string;
  expected_revision: string;
};

// 한 변경을 되돌린다. 근거(invocation·receipt)가 그 변경과 같고, 아직 되돌리지 않았고, 그 뒤에 다른 변경이
// 없을 때(지금 revision이 변경 직후 revision과 같을 때)만 원래 업무 상태로 돌린다.
export function revertChange(
  store: Store,
  input: RevertInput,
): { reverted: "add" | "complete"; todo: number } {
  const found = /^change:(\d+)$/.exec(input.receipt);
  if (!found) reject("invalid_input", "the revert receipt is not known");
  return store.transaction(() => {
    const row = store.db
      .prepare(
        "select id, kind, todo, invocation, before, reverted from change where id = ?",
      )
      .get(Number(found[1])) as Row | undefined;
    if (row === undefined || row["invocation"] !== input.invocation) {
      reject("invalid_input", "the revert receipt is not known");
    }
    if (row["kind"] === "import") {
      reject("conflict", "this change cannot be reverted");
    }
    if (row["reverted"] === 1) {
      reject("conflict", "the change was already reverted");
    }
    if (String(revisionOf(store)) !== input.expected_revision) {
      reject(
        "conflict",
        "the todos changed after this change; read them again",
      );
    }
    const todo = Number(row["todo"]);
    if (row["kind"] === "add") {
      store.db.prepare("delete from todo where id = ?").run(todo);
    } else {
      const before = JSON.parse(String(row["before"])) as {
        done: number;
        completed_at: string | null;
        version: number;
      };
      store.db
        .prepare(
          "update todo set done = ?, completed_at = ?, version = ? where id = ?",
        )
        .run(before.done, before.completed_at, before.version, todo);
    }
    store.db.prepare("update change set reverted = 1 where id = ?").run(
      Number(row["id"]),
    );
    return { reverted: row["kind"] as "add" | "complete", todo };
  });
}

// agent가 남긴 힌트는 그 할 일에 붙고 화면이 읽는다. 힌트는 할 일의 version만 올리고 되돌림 대상이 아니다.
export function addHint(
  store: Store,
  id: number,
  text: string,
  now: string,
): void {
  store.transaction(() => {
    const row = store.db.prepare("select id from todo where id = ?").get(id);
    if (row === undefined) reject("conflict", "the todo no longer exists");
    store.db
      .prepare(
        "insert into todo_hint (todo, text, created_at) values (?, ?, ?)",
      )
      .run(id, text, now);
    store.db.prepare("update todo set version = version + 1 where id = ?").run(
      id,
    );
  });
}

// 지금 고치는 할 일의 상태 revision이다. 같은 할 일의 칸·힌트·완료가 바뀌면 달라진다.
export function todoRevision(store: Store, id: number): string {
  const row = store.db.prepare("select version from todo where id = ?").get(
    id,
  ) as Row | undefined;
  return row === undefined ? `${id}.gone` : `${id}.${row["version"]}`;
}

export function privateNote(store: Store, id: number): string {
  const row = store.db
    .prepare("select private_note from todo where id = ?")
    .get(id) as Row | undefined;
  return row === undefined ? "" : String(row["private_note"]);
}

// Markdown 체크리스트: `- [ ] title`, 완료는 `- [x] title`. 비공개 메모는 내보내지 않는다.
export function toMarkdown(todos: readonly Todo[]): string {
  const lines = [...todos].reverse().map((todo) =>
    `- [${todo.done ? "x" : " "}] ${todo.title}`
  );
  return `# Todos\n\n${lines.join("\n")}${lines.length === 0 ? "" : "\n"}`;
}

export type ImportedItem = { title: string; done: boolean };

const ITEM = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/;

export function parseMarkdown(text: string): ImportedItem[] {
  const items: ImportedItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const found = ITEM.exec(line);
    if (found && found[2].length <= 200) {
      items.push({ title: found[2], done: found[1] !== " " });
    }
  }
  return items;
}

// 같은 제목이 이미 있으면 건너뛴다. 한 번의 import가 변경 하나(되돌림 대상이 아닌 `import`)다.
export function importTodos(
  store: Store,
  items: readonly ImportedItem[],
  now: string,
  invocation: string | null,
): { added: number; skipped: number } {
  return store.transaction(() => {
    const known = new Set(
      (store.db.prepare("select title from todo").all() as Row[]).map((row) =>
        String(row["title"])
      ),
    );
    let added = 0;
    for (const item of items) {
      if (known.has(item.title)) continue;
      known.add(item.title);
      store.db
        .prepare(
          "insert into todo (title, done, created_at, completed_at) values (?, ?, ?, ?)",
        )
        .run(item.title, item.done ? 1 : 0, now, item.done ? now : null);
      added += 1;
    }
    if (added > 0) record(store, "import", null, invocation, null);
    return { added, skipped: items.length - added };
  });
}
