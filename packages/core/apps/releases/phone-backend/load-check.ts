// 묶은 `phone/backend.js`를 폰과 같은 모양의 빈 곳에서 실어 선언한 handler를 정확히 등록하는지 본다.
// 빈 곳은 `node:vm`의 새 context다: 전역은 JS 내장뿐이고 require·process·fs가 없다. 폰의 guest base와 같은
// `installPhoneBackendHost`가 port를 깔고, DB는 `:memory:`다. 앱 code가 도는 곳이라 release 준비의 child에서만
// 부른다(`main.ts`).
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createContext, Script } from "node:vm";
import { webcrypto } from "node:crypto";
import { err, type LophnError, ok, type Result } from "../../../../base/mod.ts";
import {
  installPhoneBackendHost,
  type PhoneStoreDb,
} from "../../../../protocol/apps/phone-backend-host.ts";
import { handlerNames, requiredHandlerNames } from "../../declaration/mod.ts";
import type { PhoneBackendDeclaration } from "./build.ts";

// 한 번의 평가 상한이다. 등록은 동기라 넘기면 무한 loop 같은 것이다.
const EVAL_LIMIT_MS = 10_000;

function memoryDb(): PhoneStoreDb {
  const db = new DatabaseSync(":memory:");
  return {
    exec: (sql) => db.exec(sql),
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        get: (...params) => statement.get(...params),
        all: (...params) => statement.all(...params),
        run: (...params) => statement.run(...params),
      };
    },
  };
}

function firstLine(thrown: unknown): string {
  const message = (thrown as { message?: unknown } | null)?.message;
  return String(message ?? thrown).split("\n")[0];
}

export async function loadCheckPhoneBackend(
  staging: string,
  declaration: PhoneBackendDeclaration,
): Promise<Result<{ handlers: string[] }, LophnError>> {
  const source = await readFile(`${staging}/phone/backend.js`, "utf8");
  const context = createContext({});
  const db = memoryDb();
  const host = installPhoneBackendHost(context, {
    open: () => db,
    migrations: () => ({ target: 0, steps: [] }),
    randomBytes: (bytes) => {
      webcrypto.getRandomValues(bytes);
    },
  });
  try {
    new Script(source, { filename: "phone/backend.js" }).runInContext(context, {
      timeout: EVAL_LIMIT_MS,
    });
  } catch (thrown) {
    return err({
      code: "invalid_input",
      message: `backend.js failed to load: ${firstLine(thrown)}`,
    });
  }
  const registered = host.handlers();
  const allowed = handlerNames(declaration);
  const missing = requiredHandlerNames(declaration).filter(
    (name) => !registered.includes(name),
  );
  const extra = registered.filter((name) => !allowed.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    const parts = [
      ...(missing.length > 0
        ? [`does not register ${missing.join(", ")}`]
        : []),
      ...(extra.length > 0
        ? [`registers ${extra.join(", ")}, which the declaration does not list`]
        : []),
    ];
    return err({
      code: "invalid_input",
      message: `backend.js ${parts.join(" and ")}`,
    });
  }
  return ok({ handlers: registered });
}
