import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import { Button, Checkbox, Field, Input, Textarea } from "@lophn/ui-control";
import { AppShell } from "@lophn/ui-layout";
import { ReadState } from "@lophn/ui-state";
import { t } from "../../wording/t.ts";
import {
  addToCalendar,
  addTodo,
  completeTodo,
  editTodo,
  exportMarkdown,
  importMarkdown,
  listTodos,
  type Todo,
} from "./bridge.ts";
import styles from "./app.module.css";

type Notice =
  | { kind: "none" }
  | { kind: "error"; key: "save" | "file" | "calendar" }
  | { kind: "exported" }
  | { kind: "imported"; added: number }
  | { kind: "calendar" };

// todos 화면. 목록·새 할 일 입력·Markdown 내보내기와 가져오기 하나다. 문구는 모두 en catalog의 key고,
// 읽기 결과의 loading·empty·error는 ui-state의 ReadState가 그린다. 같은 화면이 full과 panel(320px)에서 쓰인다.
export function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<Notice>({ kind: "none" });
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [file, setFile] = useState("todos.md");
  const [editing, setEditing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTodos(await listTodos());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 실패는 이유 없이 한 문장으로만 알린다. 성공하면 목록을 다시 읽는다.
  async function run(work: () => Promise<Notice>, failure: Notice) {
    try {
      setNotice(await work());
      await load();
    } catch {
      setNotice(failure);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim() === "") return;
    void run(async () => {
      await addTodo(
        title,
        note,
        due === "" ? "" : new Date(due).toISOString(),
      );
      setTitle("");
      setNote("");
      setDue("");
      return { kind: "none" };
    }, { kind: "error", key: "save" });
  }

  async function edit(id: number) {
    const next = editing === id ? null : id;
    setEditing(next);
    try {
      await editTodo(next);
    } catch {
      // 알리지 못해도 화면 동작은 그대로다. agent가 이 화면의 상태를 못 읽을 뿐이다.
    }
  }

  const message = notice.kind === "error"
    ? t(
      notice.key === "save"
        ? "todos.error.save-failed"
        : notice.key === "file"
        ? "todos.error.file-failed"
        : "todos.error.calendar-failed",
    )
    : notice.kind === "exported"
    ? t("todos.status.exported")
    : notice.kind === "imported"
    ? t("todos.status.imported", { added: notice.added })
    : notice.kind === "calendar"
    ? t("todos.status.calendar-added")
    : undefined;

  return (
    <AppShell title={t("todos.title.screen")}>
      <form className={styles.form} onSubmit={submit}>
        <Field label={t("todos.label.new-todo")}>
          <Input
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label={t("todos.label.private-note")}>
          <Textarea
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Field label={t("todos.label.due")}>
          <Input
            type="datetime-local"
            value={due}
            onChange={(event) => setDue(event.target.value)}
          />
        </Field>
        <div className={styles.actions}>
          <Button type="submit" variant="primary">
            {t("todos.button.add")}
          </Button>
        </div>
      </form>
      {message !== undefined && (
        <p
          className={styles.notice}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      )}
      <ReadState
        loading={loading}
        failed={failed ? t("todos.label.todos") : undefined}
        onRetry={() => void load()}
        isEmpty={todos.length === 0}
        empty={{
          icon: Inbox,
          message: t("todos.empty.none"),
          action: {
            label: t("todos.button.reload"),
            onSelect: () => void load(),
          },
        }}
      >
        <p className={styles.count}>
          {t("todos.label.count", { count: todos.length })}
        </p>
        <ul className={styles.list}>
          {todos.map((todo) => (
            <li key={todo.id} className={styles.row}>
              <Checkbox
                label={todo.title}
                checked={todo.done}
                disabled={todo.done}
                onCheckedChange={(checked) => {
                  if (checked) {
                    void run(async () => {
                      await completeTodo(todo.id);
                      return { kind: "none" };
                    }, { kind: "error", key: "save" });
                  }
                }}
              />
              {(todo.due !== null || todo.hints.length > 0) && (
                <p className={styles.meta}>
                  {todo.due !== null &&
                    `${t("todos.label.due")}: ${todo.due} `}
                  {todo.hints.length > 0 &&
                    t("todos.label.hint-count", { count: todo.hints.length })}
                </p>
              )}
              <div className={styles.rowActions}>
                <Button
                  size="sm"
                  variant={editing === todo.id ? "primary" : "secondary"}
                  onClick={() => void edit(todo.id)}
                >
                  {editing === todo.id
                    ? t("todos.label.editing")
                    : t("todos.button.edit")}
                </Button>
                {todo.due !== null && (
                  <Button
                    size="sm"
                    onClick={() =>
                      void run(async () => {
                        await addToCalendar(todo.id);
                        return { kind: "calendar" };
                      }, { kind: "error", key: "calendar" })}
                  >
                    {t("todos.button.calendar")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </ReadState>
      <div className={styles.files}>
        <Field label={t("todos.label.file-name")}>
          <Input
            value={file}
            maxLength={80}
            onChange={(event) => setFile(event.target.value)}
          />
        </Field>
        <div className={styles.actions}>
          <Button
            onClick={() =>
              void run(async () => {
                await exportMarkdown(file);
                return { kind: "exported" };
              }, { kind: "error", key: "file" })}
          >
            {t("todos.button.export")}
          </Button>
          <Button
            onClick={() =>
              void run(async () => ({
                kind: "imported",
                added: await importMarkdown(file),
              }), { kind: "error", key: "file" })}
          >
            {t("todos.button.import")}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
