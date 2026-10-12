// 다른 앱 호출의 인증된 출처 AppCallOrigin을 만든다. 입력 본문의
// path·caller 주장은 읽지 않는다. 부모 호출과 path는 준비 서비스가 직접 본 사실에서만 이어진다.
//
// path는 broker 요청에 실리지 않는다. 그래서 서비스가 (1) 자기가 발급한 origin과 (2) broker가
// 본 start 사실(호출을 받은 앱이 보낸 caller 근거)을 묶어 "이 invocation은 어떤 path로 들어왔나"를
// 안다. 시작 사실이 없는 호출(ledger에 남기지 않는 성공 일반 read, 아직 전달되지 않은 start)은
// 부모로 알려지지 않아 부모 없음·새 path로 시작한다. 이 한계는 plan T15에 적었다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  appCallDepthAllowed,
  type AppCallOrigin,
} from "../../../protocol/apps/mod.ts";

export type OriginSource = {
  app: string;
  release: string;
  processNonce: string;
};

type IssuedOrigin = {
  app: string;
  release: string;
  parent: string | null;
  path: readonly string[];
  expiresAtMs: number;
};

// 프로세스마다 기억하는 상한이다. 넘으면 가장 오래된 것부터 잊는다.
export const KNOWN_INVOCATION_LIMIT = 4096;
export const ISSUED_ORIGIN_LIMIT = 256;

export type PathBook = {
  // target 프로세스가 받을 수 있는 호출 하나를 기억한다.
  issued(
    target: { processNonce: string },
    origin: AppCallOrigin,
    expiresAtMs: number,
  ): void;
  // 그 프로세스가 시작한 호출을 안다. caller가 앱이면 들어온 origin의 path를 잇는다.
  started(
    child: { processNonce: string },
    invocation: string,
    caller: { kind: string; app?: string; release?: string; parent?: unknown },
  ): void;
  next(input: {
    source: OriginSource;
    target: string;
    grant: string;
    parent: string | null;
    // 처리 중인 호출이 다른 앱에게서 받은 것이면 그 출처의 식별. 서비스가 발급한 origin 중
    // 이 프로세스가 받은 것과 맞춰 보고 path는 서비스의 값을 쓴다. 모르면 거절한다.
    incoming?: { app: string; release: string; parent: string | null };
  }): Result<AppCallOrigin>;
  // 알려진 부모면 그대로, 모르면 null이다(부모 없음으로 남긴다).
  parentOf(processNonce: string, parent: string | null): string | null;
  forget(processNonce: string): void;
  // 시험·관측: 기억하는 invocation과 origin 수.
  readonly size: { invocations: number; origins: number };
};

export function createPathBook(clock: { nowMs(): number }): PathBook {
  const known = new Map<string, Map<string, readonly string[]>>();
  const incoming = new Map<string, IssuedOrigin[]>();

  function prune(list: IssuedOrigin[]): void {
    const now = clock.nowMs();
    for (let index = list.length - 1; index >= 0; index--) {
      if (list[index].expiresAtMs <= now) list.splice(index, 1);
    }
  }

  return {
    issued(target, origin, expiresAtMs) {
      let list = incoming.get(target.processNonce);
      if (list === undefined) {
        list = [];
        incoming.set(target.processNonce, list);
      }
      prune(list);
      list.push({
        app: origin.app,
        release: origin.release,
        parent: origin.parent_invocation,
        path: origin.path,
        expiresAtMs,
      });
      if (list.length > ISSUED_ORIGIN_LIMIT) list.shift();
    },
    started(child, invocation, caller) {
      let path: readonly string[] = [];
      if (caller.kind === "app") {
        const list = incoming.get(child.processNonce) ?? [];
        prune(list);
        const match = [...list].reverse().find((item) =>
          item.app === caller.app && item.release === caller.release &&
          item.parent === (caller.parent ?? null)
        );
        // 발급 기록을 잃었으면 path를 모른다. 모르는 path를 지어 채우지 않는다.
        if (match !== undefined) path = match.path;
      }
      let calls = known.get(child.processNonce);
      if (calls === undefined) {
        calls = new Map();
        known.set(child.processNonce, calls);
      }
      calls.set(invocation, path);
      if (calls.size > KNOWN_INVOCATION_LIMIT) {
        calls.delete(calls.keys().next().value as string);
      }
    },
    parentOf(processNonce, parent) {
      if (parent === null) return null;
      return known.get(processNonce)?.has(parent) ? parent : null;
    },
    next({ source, target, grant, parent, incoming: claimed }) {
      const calls = known.get(source.processNonce);
      const inherited = parent === null ? undefined : calls?.get(parent);
      const knownParent = inherited === undefined ? null : parent;
      let base: readonly string[] = inherited ?? [];
      if (claimed !== undefined) {
        const list = incoming.get(source.processNonce) ?? [];
        prune(list);
        const matches = list.filter((item) =>
          item.app === claimed.app && item.release === claimed.release &&
          item.parent === claimed.parent
        );
        if (matches.length === 0) {
          return err({
            code: "invalid_input",
            message: "call origin is not known",
          });
        }
        // 같은 식별로 들어온 경로가 여럿이면 가장 긴 것으로 본다. 짧은 경로를 고르게 두지 않는다.
        for (const item of matches) {
          if (item.path.length > base.length) base = item.path;
        }
      }
      const path = [...base];
      if (path.includes(source.app)) {
        return err({
          code: "invalid_input",
          message: "call path repeats an app",
        });
      }
      path.push(source.app);
      if (!appCallDepthAllowed(path, target)) {
        return err({
          code: "invalid_input",
          message: "call path repeats an app or is too deep",
        });
      }
      return ok({
        kind: "app",
        app: source.app,
        release: source.release,
        process_nonce: source.processNonce,
        grant,
        parent_invocation: knownParent,
        path,
      });
    },
    forget(processNonce) {
      known.delete(processNonce);
      incoming.delete(processNonce);
    },
    get size() {
      let invocations = 0;
      for (const calls of known.values()) invocations += calls.size;
      let origins = 0;
      for (const list of incoming.values()) origins += list.length;
      return { invocations, origins };
    },
  };
}

type SubmitSide = {
  submit(
    child: { processNonce: string },
    body: unknown,
  ): Result<{ accepted: true }>;
  childExited(processNonce: string): number;
};

function plain(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

// broker의 invocations 서비스를 감싸 start 사실을 path 장부에 알린다. 사실의 기록과 전달은
// 감싼 서비스가 그대로 한다. 형식이 맞지 않는 본문은 감싼 서비스가 거절하므로 여기서는 무시한다.
export function observeStarts<T extends SubmitSide>(
  inner: T,
  book: PathBook,
): T {
  const observed = {
    ...inner,
    submit(child: { processNonce: string }, body: unknown) {
      const result = inner.submit(child, body);
      const submitted = plain(body);
      const summary = plain(submitted?.["summary"]);
      const caller = plain(summary?.["caller"]);
      if (
        result.ok && submitted?.["fact"] === "start" &&
        typeof submitted["invocation"] === "string" &&
        typeof caller?.["kind"] === "string"
      ) {
        book.started(child, submitted["invocation"], {
          kind: caller["kind"],
          app: typeof caller["app"] === "string" ? caller["app"] : undefined,
          release: typeof caller["release"] === "string"
            ? caller["release"]
            : undefined,
          parent: caller["parent_invocation"],
        });
      }
      return result;
    },
    childExited(processNonce: string) {
      book.forget(processNonce);
      return inner.childExited(processNonce);
    },
  };
  return observed as T;
}
