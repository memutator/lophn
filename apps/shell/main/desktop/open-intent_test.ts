import assert from "node:assert/strict";
import { test } from "node:test";

import {
  openUrlIntent,
  readCodingLink,
  readConfirmLink,
  readOpenIntent,
  registerUrlScheme,
} from "./open-intent.ts";
import { startSingleInstance } from "./single-instance.ts";

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const APR = "apr_01j9zzzzzzzzzzzzzzzzzzzzzz";
const QST = "qst_01j9zzzzzzzzzzzzzzzzzzzzzz";
const CAC = "cac_01j9zzzzzzzzzzzzzzzzzzzzzz";
const TKT = "tkt_01j9zzzzzzzzzzzzzzzzzzzzzz";
const EXEC = "/opt/lophn/lophn-desktop";

test("shell/desktop#R14: --open-app은 바로 뒤의 앱 ID 하나만 읽고 Chromium switch는 보지 않는다", () => {
  assert.deepEqual(
    readOpenIntent([EXEC, "--allow-file-access", "--open-app", APP]),
    { kind: "app", app: APP },
  );
  for (
    const argv of [
      [EXEC, "--open-app"],
      [EXEC, "--open-app", "app_bad"],
      [EXEC, `--open-app=${APP}`],
      [EXEC, "--open-app", APP, "--open-app", APP],
      [EXEC, "--open-app", `${APP}/../../etc/passwd`],
      [EXEC, "--open-app", "/home/person/app/src/main.ts"],
      [EXEC, "--open-app", APP.toUpperCase()],
      [EXEC, "--open-app", APP, `lophn://things-to-confirm/${APR}`],
      [EXEC, "https://evil.example/steal", "/etc/passwd"],
    ]
  ) {
    assert.deepEqual(readOpenIntent(argv), { kind: "window" }, argv.join(" "));
  }
  assert.deepEqual(readOpenIntent([EXEC, "--open-app", APP, "--quit"]), {
    kind: "quit",
  });
});

test("shell/desktop#R14: lophn://things-to-confirm/<id> 링크는 approval·질문 ID 하나만 엄격히 읽는다", () => {
  assert.equal(readConfirmLink(`lophn://things-to-confirm/${APR}`), APR);
  assert.equal(readConfirmLink(`lophn://things-to-confirm/${QST}`), QST);
  assert.deepEqual(readOpenIntent([EXEC, `lophn://things-to-confirm/${QST}`]), {
    kind: "things-to-confirm",
    request: QST,
  });
  for (
    const url of [
      `lophn://things-to-confirm/${APR}/`,
      `lophn://things-to-confirm/${APR}?approve=1`,
      `lophn://things-to-confirm/${APR}#x`,
      `LOPHN://things-to-confirm/${APR}`,
      `lophn://things-to-confirm/apr_bad`,
      `lophn://approvals/${APR}`,
      `lophn:things-to-confirm/${APR}`,
      `https://things-to-confirm/${APR}`,
      `lophn://things-to-confirm/${APR}\n`,
    ]
  ) {
    assert.equal(readConfirmLink(url), undefined, url);
    assert.deepEqual(openUrlIntent(url), { kind: "window" }, url);
  }
  assert.deepEqual(
    readOpenIntent([
      EXEC,
      `lophn://things-to-confirm/${APR}`,
      `lophn://things-to-confirm/${QST}`,
    ]),
    { kind: "window" },
  );
});

test("shell/desktop#R14: coding agent의 회수·취소·생성 링크는 cac·tkt·app ID 하나만 읽고 화면만 연다", () => {
  for (const id of [CAC, TKT, APP]) {
    assert.equal(readCodingLink(`lophn://things-to-confirm/${id}`), id);
    assert.equal(readConfirmLink(`lophn://things-to-confirm/${id}`), undefined);
    assert.deepEqual(
      readOpenIntent([EXEC, `lophn://things-to-confirm/${id}`]),
      {
        kind: "coding",
        target: id,
      },
    );
  }
  for (
    const url of [
      `lophn://things-to-confirm/${CAC}/`,
      `lophn://things-to-confirm/${CAC}?revoke=1`,
      `lophn://things-to-confirm/${TKT}#x`,
      `LOPHN://things-to-confirm/${TKT}`,
      `lophn://things-to-confirm/cac_bad`,
      `lophn://things-to-confirm/prb_01j9zzzzzzzzzzzzzzzzzzzzzz`,
      `lophn://connections/${CAC}`,
      `lophn://things-to-confirm/${CAC}\n`,
    ]
  ) {
    assert.equal(readCodingLink(url), undefined, url);
    assert.deepEqual(openUrlIntent(url), { kind: "window" }, url);
  }
  // 링크가 둘이면 어느 것도 열지 않는다.
  assert.deepEqual(
    readOpenIntent([
      EXEC,
      `lophn://things-to-confirm/${CAC}`,
      `lophn://things-to-confirm/${TKT}`,
    ]),
    { kind: "window" },
  );
});

test("shell/desktop#R13, R14: second-instance는 앱 intent·링크·종료·기본 창을 나눠 부른다", () => {
  const calls: string[] = [];
  let fire: ((...args: unknown[]) => void) | undefined;
  startSingleInstance({
    dataRoot: "/home/data",
    onOpenWindow: () => calls.push("window"),
    onQuitIntent: () => calls.push("quit"),
    onOpenApp: (app) => calls.push(`app ${app}`),
    onThingsToConfirm: (request) => calls.push(`confirm ${request}`),
    onCoding: (target) => calls.push(`coding ${target}`),
    app: {
      requestSingleInstanceLock: () => true,
      quit: () => {},
      on: (_event, listener) => {
        fire = listener;
      },
    },
  });
  fire?.({}, [EXEC, "--open-app", APP], "/work", { dataRoot: "/home/data" });
  fire?.({}, [EXEC, `lophn://things-to-confirm/${APR}`], "/work");
  fire?.({}, [EXEC, `lophn://things-to-confirm/${CAC}`], "/work");
  fire?.({}, [EXEC, "--open-app", "app_bad"], "/work");
  fire?.({}, [EXEC, "--quit"], "/work");
  fire?.({}, "not-an-argv", "/work");
  assert.deepEqual(calls, [
    `app ${APP}`,
    `confirm ${APR}`,
    `coding ${CAC}`,
    "window",
    "quit",
    "window",
  ]);
});

test("shell/desktop#R14: lophn URL scheme은 packaged 실행에서만 OS에 등록하고 headless는 건드리지 않는다", () => {
  const registered: string[] = [];
  const port = {
    setAsDefaultProtocolClient: (scheme: string) => {
      registered.push(scheme);
      return true;
    },
  };
  assert.equal(
    registerUrlScheme({ packaged: false, headless: false, port }),
    false,
  );
  assert.equal(
    registerUrlScheme({ packaged: true, headless: true, port }),
    false,
  );
  assert.deepEqual(registered, []);
  assert.equal(
    registerUrlScheme({ packaged: true, headless: false, port }),
    true,
  );
  assert.deepEqual(registered, ["lophn"]);
});
