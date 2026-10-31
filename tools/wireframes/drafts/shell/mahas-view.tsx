// MaHas 앱이 그린 화면의 고정 그림(한도 탭). 앱 view는 앱이 그리므로 lophn 화면이 아니고, shell draft의 앱 tab 자리에 들어간다.
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { AlertTriangle, CircleAlert, RefreshCw } from "lucide-react";

import {
  type Vendor,
  VendorIcon,
} from "../../../../packages/shell/renderer/parts/vendor-icon/vendor-icon.tsx";
import { shellIcons } from "./icons.ts";
import styles from "./mahas.module.css";

interface Bar {
  readonly label: string;
  readonly percent: number;
  readonly reset: string;
  readonly warn?: boolean;
}

interface Account {
  readonly name: string;
  readonly plan?: string;
  readonly when: string;
  readonly bars?: readonly Bar[];
  readonly note?: { readonly text: string; readonly error?: boolean };
}

interface Harness {
  readonly name: string;
  readonly vendor: Vendor;
  readonly accounts: readonly Account[];
}

const LEFT: readonly Harness[] = [
  {
    name: "Claude Code",
    vendor: "claude",
    accounts: [
      {
        name: "Claude 계정",
        when: "3분 전",
        bars: [
          { label: "5시간", percent: 31, reset: "4시간 16분" },
          { label: "주간", percent: 35, reset: "5일 20시간" },
        ],
      },
    ],
  },
  {
    name: "Codex",
    vendor: "openai",
    accounts: [
      {
        name: "py…@gmail.com",
        when: "3분 전",
        note: { text: "한도를 읽지 못했습니다" },
      },
    ],
  },
  {
    name: "OpenCode",
    vendor: "opencode",
    accounts: [
      {
        name: "OpenCode Go 계정",
        when: "3분 전",
        bars: [
          { label: "주간", percent: 70, reset: "14시간 16분" },
          { label: "월간", percent: 90, reset: "13일 20시간", warn: true },
        ],
        note: { text: "월간 한도를 거의 다 썼습니다" },
      },
    ],
  },
];

const RIGHT: readonly Harness[] = [
  {
    name: "Devin",
    vendor: "devin",
    accounts: [
      {
        name: "Devin 계정",
        when: "조회 못 함",
        note: { text: "조회가 계속 실패하고 있습니다" },
      },
    ],
  },
  {
    name: "Cline",
    vendor: "cline",
    accounts: [
      {
        name: "Cline 계정",
        when: "조회 못 함",
        note: { text: "Cline에서 다시 로그인하세요", error: true },
      },
    ],
  },
  {
    name: "Grok Build",
    vendor: "grok",
    accounts: [
      {
        name: "me…@gmail.com",
        when: "3분 전",
        note: { text: "한도를 읽지 못했습니다" },
      },
    ],
  },
];

const TILES = [
  { label: "계정", value: "8", meta: "하네스 7개" },
  { label: "쓸 수 있음", value: "5/8", meta: "다시 로그인 2 · 조회 못 함 1" },
  { label: "가장 높은 사용률", value: "90%", meta: "OpenCode Go · 월간" },
  {
    label: "가장 빠른 초기화",
    value: "13일 20시간",
    meta: "OpenCode Go · 월간",
  },
];

export function MahasView() {
  return (
    <div className={styles.view}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>MaHas</h1>
          <p className={styles.subtitle}>하네스 토큰 사용량과 계정 한도</p>
        </div>
        <span className={styles.actions}>
          <Button size="sm" variant="secondary">
            <Icon icon={shellIcons.add} pixels={14} />
            계정 추가
          </Button>
          <IconButton icon={RefreshCw} label="새로 고침" size="sm" />
          <IconButton icon={shellIcons.more} label="더 보기" size="sm" />
        </span>
      </div>

      <div className={styles.tabs} role="tablist">
        {["한도", "사용량", "패턴"].map((label, index) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={index === 0}
            className={styles.tab}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.tiles}>
        {TILES.map((tile) => (
          <div key={tile.label} className={styles.tile}>
            <span className={styles.tileLabel}>{tile.label}</span>
            <span className={styles.tileValue}>{tile.value}</span>
            <span className={styles.tileMeta}>{tile.meta}</span>
          </div>
        ))}
      </div>

      <div className={styles.columns}>
        {[LEFT, RIGHT].map((column, index) => (
          <div key={index} className={styles.column}>
            {column.map((harness) => (
              <section key={harness.name} className={styles.group}>
                <div className={styles.groupHead}>
                  <VendorIcon vendor={harness.vendor} size={14} />
                  <span>{harness.name}</span>
                  <span className={styles.grow} />
                  <IconButton
                    icon={shellIcons.add}
                    label="계정 추가"
                    size="sm"
                  />
                </div>
                <div className={styles.card}>
                  {harness.accounts.map((account) => (
                    <AccountRow key={account.name} account={account} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountRow({ account }: { account: Account }) {
  return (
    <div className={styles.account}>
      <div className={styles.accountHead}>
        <span className={styles.accountName}>{account.name}</span>
        <span className={styles.when}>
          {account.when}
          <Icon icon={shellIcons.collapse} pixels={14} />
        </span>
      </div>
      {account.bars?.map((bar) => (
        <div key={bar.label} className={styles.bar}>
          <span className={styles.barLabel}>{bar.label}</span>
          <span className={styles.track}>
            <span
              className={styles.fill}
              data-warn={bar.warn || undefined}
              style={{ width: `${bar.percent}%` }}
            />
          </span>
          <span className={styles.percent} data-warn={bar.warn || undefined}>
            {bar.warn ? <Icon icon={AlertTriangle} pixels={12} /> : null}
            {bar.percent}%
          </span>
          <span className={styles.reset}>{bar.reset}</span>
        </div>
      ))}
      {account.note === undefined ? null : (
        <span
          className={styles.note}
          data-error={account.note.error || undefined}
        >
          <Icon
            icon={account.note.error ? CircleAlert : AlertTriangle}
            pixels={14}
          />
          {account.note.text}
        </span>
      )}
    </div>
  );
}
