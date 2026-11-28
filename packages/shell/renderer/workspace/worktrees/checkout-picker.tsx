// 새 세션·터미널을 어느 체크아웃에서 열지 고르는 줄(spec 5.3.1). worktree가 하나라도 있을 때만 + 메뉴와 왼쪽 sidebar + 목록 위에 선다.
// 기본은 원래 폴더(Main)이고, 고른 대상으로 한 번 연 뒤에는 다시 Main으로 돌아간다.
import { t } from "@lophn/i18n";
import { MenuIcon, type MenuItem, PopoverRow } from "@lophn/ui/overlay";
import { Icon } from "@lophn/ui/primitives";
import { commonIcons, sourceControlIcons } from "../../icons/mod.ts";
import styles from "./checkout-picker.module.css";

export interface CheckoutChoice {
  /** worktree id. 원래 폴더는 null. */
  readonly id: string | null;
  /** 브랜치 이름(원래 폴더는 `Main (<branch>)`). */
  readonly label: string;
  /** 바뀐 파일 수. 0이면 보이지 않는다. */
  readonly changed: number;
}

export interface CheckoutPickerModel {
  /** 첫 줄은 원래 폴더다. */
  readonly choices: readonly CheckoutChoice[];
  readonly selected: string | null;
  select(id: string | null): void;
  /** `+ New worktree…`. 만들면 그 worktree를 고른다. 쓰기 허락이 없으면 없다. */
  readonly onNew?: () => void;
}

const PREFIX = "checkout:";
const MAIN = `${PREFIX}main`;
export const CHECKOUT_NEW = "checkout-new";

/** Menu 항목의 id면 고른 worktree(원래 폴더는 null)이고, 대상 줄이 아니면 undefined다. */
export function checkoutOfItem(id: string): string | null | undefined {
  if (id === MAIN) return null;
  return id.startsWith(PREFIX) ? id.slice(PREFIX.length) : undefined;
}

const labelOf = (choice: CheckoutChoice) =>
  choice.changed > 0
    ? t("worktree-open.label.choice-changed", {
        branch: choice.label,
        count: choice.changed,
      })
    : choice.label;

/** 새 탭(+) Menu의 머리 묶음. 대상 줄을 눌러도 Menu는 닫지 않는다(부르는 쪽이 막는다). */
export function checkoutMenuItems(model: CheckoutPickerModel): MenuItem[] {
  const rows: MenuItem[] = model.choices.map((choice, index) => ({
    id: choice.id === null ? MAIN : `${PREFIX}${choice.id}`,
    label: labelOf(choice),
    textValue: choice.label,
    data: { "data-checkout-choice": choice.id ?? "main" },
    leading:
      choice.id === model.selected ? (
        <MenuIcon icon={sourceControlIcons.resolved} />
      ) : (
        <MenuIcon icon={sourceControlIcons.branch} />
      ),
    ...(index === 0 ? { heading: t("worktree-open.heading.open-in") } : {}),
  }));
  if (model.onNew !== undefined) {
    rows.push({
      id: CHECKOUT_NEW,
      label: t("worktree-open.button.new-worktree"),
      leading: <MenuIcon icon={commonIcons.add} />,
      data: { "data-checkout-new": "" },
    });
  }
  return rows;
}

/** 왼쪽 sidebar + hover 목록의 머리 묶음. */
export function CheckoutPicker({ model }: { model: CheckoutPickerModel }) {
  return (
    <div className={styles.picker} data-checkout-picker="">
      <div className={styles.head}>{t("worktree-open.heading.open-in")}</div>
      {model.choices.map((choice) => (
        <PopoverRow
          key={choice.id ?? "main"}
          onSelect={() => model.select(choice.id)}
        >
          <span
            className={styles.row}
            data-checkout-choice={choice.id ?? "main"}
            aria-pressed={choice.id === model.selected}
          >
            <span className={styles.mark}>
              {choice.id === model.selected ? (
                <Icon icon={sourceControlIcons.resolved} pixels={14} />
              ) : null}
            </span>
            <span className={styles.label}>{labelOf(choice)}</span>
          </span>
        </PopoverRow>
      ))}
      {model.onNew === undefined ? null : (
        <PopoverRow onSelect={model.onNew}>
          <span className={styles.row} data-checkout-new="">
            <span className={styles.mark}>
              <Icon icon={commonIcons.add} pixels={14} />
            </span>
            <span className={styles.label}>
              {t("worktree-open.button.new-worktree")}
            </span>
          </span>
        </PopoverRow>
      )}
      <div className={styles.divider} />
    </div>
  );
}
