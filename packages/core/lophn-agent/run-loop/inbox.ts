import type { Id } from "../../../protocol/base/ids.ts";
import type { RoutedInput } from "../../router/ports.ts";

// session마다 하나인 메모리 입력함이다. 꺼졌다 켜지면 사라지고, 기다리던 call은 Router가
// failed(lophn_restarted)로 닫는다. 입력 하나가 turn 하나이므로 turn이 돌면 다음 turn까지 쌓아 둔다.
// 순서: 사람 메시지가 먼저이고 그 안에서는 들어온 순서, 그다음 나머지가 들어온 순서.

type Session = Id<"ses">;
type Entry = { order: number; input: RoutedInput };

export type Inbox = {
  // steer이고 도는 turn이 있으면 입력함이 아니라 steering 목록에 들어간다.
  put(session: Session, input: RoutedInput): void;
  // 꺼내지 않고 맨 앞 입력을 본다.
  next(session: Session): RoutedInput | undefined;
  // 맨 앞 입력을 꺼낸다.
  take(session: Session): RoutedInput | undefined;
  // 도는 turn의 다음 model 요청 앞에 붙일 steer 입력. 반영한 만큼 `settleSteering`으로 비운다.
  pendingSteering(session: Session): readonly RoutedInput[];
  settleSteering(session: Session, count: number): void;
  // turn이 도는 중인지. turn을 시작할 때 true, 끝나면 false로 둔다.
  setRunning(session: Session, running: boolean): void;
  isRunning(session: Session): boolean;
  // 입력함의 사람 메시지 하나를 지금 도는 turn의 steer로 올린다. 가져간 것이거나 도는 turn이 없으면 false다.
  steerNow(session: Session, message: string): boolean;
  // 입력함에서 메시지 하나를 뺀다. 이미 가져갔으면 false다.
  remove(session: Session, message: string): boolean;
  // 입력이 기다리는 session을 먼저 시작할 순서대로 준다.
  waiting(): readonly Session[];
  // archive나 지움에서 입력과 steering을 비운다.
  clear(session: Session): void;
};

// 도는 turn이 없을 때의 steer는 일반 사람 메시지와 같아 turn 시작 입력이 된다.
function asNextTurn(input: RoutedInput): RoutedInput {
  return input.delivery === "steer"
    ? { ...input, delivery: "next_turn" }
    : input;
}

function head(entries: readonly Entry[]): Entry | undefined {
  let found: Entry | undefined;
  for (const entry of entries) {
    const human = entry.input.kind === "message";
    const foundHuman = found?.input.kind === "message";
    if (
      found === undefined || (human && !foundHuman) ||
      (human === foundHuman && entry.order < found.order)
    ) found = entry;
  }
  return found;
}

export function createInbox(): Inbox {
  const queued = new Map<Session, Entry[]>();
  const steering = new Map<Session, RoutedInput[]>();
  const running = new Set<Session>();
  let counter = 0;

  return {
    put(session, input) {
      if (input.delivery === "steer" && running.has(session)) {
        steering.set(session, [...(steering.get(session) ?? []), input]);
        return;
      }
      counter += 1;
      queued.set(session, [...(queued.get(session) ?? []), {
        order: counter,
        input: asNextTurn(input),
      }]);
    },
    next(session) {
      return head(queued.get(session) ?? [])?.input;
    },
    take(session) {
      const entries = queued.get(session) ?? [];
      const first = head(entries);
      if (first === undefined) return undefined;
      const rest = entries.filter((entry) => entry !== first);
      if (rest.length === 0) queued.delete(session);
      else queued.set(session, rest);
      return first.input;
    },
    steerNow(session, message) {
      if (!running.has(session)) return false;
      const entries = queued.get(session) ?? [];
      const found = entries.find((entry) => entry.input.message === message);
      if (found === undefined || found.input.kind !== "message") return false;
      this.remove(session, message);
      steering.set(session, [
        ...(steering.get(session) ?? []),
        { ...found.input, delivery: "steer" },
      ]);
      return true;
    },
    remove(session, message) {
      const entries = queued.get(session) ?? [];
      const rest = entries.filter((entry) => entry.input.message !== message);
      if (rest.length === entries.length) return false;
      if (rest.length === 0) queued.delete(session);
      else queued.set(session, rest);
      return true;
    },
    pendingSteering(session) {
      return steering.get(session) ?? [];
    },
    settleSteering(session, count) {
      const rest = (steering.get(session) ?? []).slice(count);
      if (rest.length === 0) steering.delete(session);
      else steering.set(session, rest);
    },
    setRunning(session, value) {
      if (value) {
        running.add(session);
        return;
      }
      running.delete(session);
      // 끝난 turn에 반영하지 못한 steer는 일반 사람 메시지처럼 다음 turn 입력이 된다.
      const left = steering.get(session) ?? [];
      steering.delete(session);
      for (const input of left) {
        counter += 1;
        queued.set(session, [...(queued.get(session) ?? []), {
          order: counter,
          input: asNextTurn(input),
        }]);
      }
    },
    isRunning(session) {
      return running.has(session);
    },
    waiting() {
      const heads: { session: Session; entry: Entry }[] = [];
      for (const [session, entries] of queued) {
        const first = head(entries);
        if (first !== undefined) heads.push({ session, entry: first });
      }
      return heads.sort((a, b) => {
        const human = Number(b.entry.input.kind === "message") -
          Number(a.entry.input.kind === "message");
        return human !== 0 ? human : a.entry.order - b.entry.order;
      }).map((item) => item.session);
    },
    clear(session) {
      queued.delete(session);
      steering.delete(session);
      running.delete(session);
    },
  };
}
