// float chip 묶음. 전역 float이 먼저이고 그 뒤가 지금 desk의 float이다. 작업 표시줄(아이콘과 이름)과 꺼졌을 때의
// tab 줄 끝(아이콘만)이 같이 쓴다. 바깥을 누를 때 float이 접히지 않도록 `data-float-chips`를 단다(float-layer.tsx NOT_OUTSIDE).
// 주인(agent session)이 있는 float은 전역·desk를 가리지 않고 주인마다 chip 하나(avatar와 개수)로 묶여 그 주인의 첫 float 자리에 서고,
// 누르면 그 주인의 float 목록이 펴진다. 사람의 float은 하나씩 선다. 끄는 browser 탭을 주인 chip에 놓으면 그 session에 넘긴다(tab-drag.tsx).
import { t } from "@lophn/i18n";
import { Icon } from "@lophn/ui/primitives";
import { Menu, MenuIcon, type MenuItem, Tooltip } from "@lophn/ui/overlay";
import type { ReactNode } from "react";

import { browserIcons } from "../../icons/mod.ts";
import { OwnerMark, useOwners } from "../../parts/agent-session/owner.tsx";
import styles from "./float-chips.module.css";

export interface FloatChip {
  readonly key: string;
  /** tooltip과 접근성 이름. */
  readonly title: string;
  readonly icon: ReactNode;
  /** 이름을 보이는 chip의 글. 없으면 title이다. */
  readonly label?: string;
  /** float 탭의 주인 session. 같은 주인의 float은 chip 하나로 묶인다. 없으면 사람의 float이다. */
  readonly owner?: string;
}

interface Member {
  readonly chip: FloatChip;
  readonly global: boolean;
}

// 줄에 서는 chip 하나. 주인 chip은 그 주인의 float을 모두 든다.
type Slot =
  | { readonly kind: "float"; readonly member: Member }
  | {
      readonly kind: "owner";
      readonly owner: string;
      readonly members: readonly Member[];
    };

function slotsOf(members: readonly Member[]): Slot[] {
  const slots: Slot[] = [];
  const byOwner = new Map<string, Member[]>();
  for (const member of members) {
    const owner = member.chip.owner;
    if (owner === undefined) {
      slots.push({ kind: "float", member });
      continue;
    }
    const list = byOwner.get(owner);
    if (list !== undefined) {
      list.push(member);
      continue;
    }
    const fresh = [member];
    byOwner.set(owner, fresh);
    slots.push({ kind: "owner", owner, members: fresh });
  }
  return slots;
}

const slotKey = (slot: Slot) =>
  slot.kind === "float" ? slot.member.chip.key : `owner:${slot.owner}`;

// 아이콘 오른쪽 아래의 작은 지구본. 전역 float(모든 workspace에 사는 float)의 표시다.
const globalMark = (
  <Icon icon={browserIcons.globe} pixels={8} className={styles.globalMark} />
);

function memberItem({ chip, global }: Member): MenuItem {
  return {
    id: chip.key,
    label: chip.title,
    leading: (
      <MenuIcon>
        <span className={styles.lead}>
          {chip.icon}
          {global ? globalMark : null}
        </span>
      </MenuIcon>
    ),
  };
}

// 주인 chip. 누르면 그 주인의 float 목록이 펴지고 고른 것을 편다.
function OwnerChip({
  owner,
  members,
  named,
  pressed,
  onPick,
}: {
  owner: string;
  members: readonly Member[];
  named: boolean;
  pressed: readonly string[];
  onPick: (key: string) => void;
}) {
  const { name } = useOwners()(owner);
  const label = t("shell.label.owner-chip", { name, count: members.length });
  // menu는 기본 자리(beside)라 창 맨 아래 작업 표시줄에서는 위로 펴진다.
  return (
    <Menu
      onSelect={onPick}
      items={members.map((member, index) =>
        index === 0
          ? { ...memberItem(member), heading: name }
          : memberItem(member),
      )}
      trigger={
        <button
          type="button"
          className={styles.chip}
          data-named={named || undefined}
          data-owner-chip={owner}
          data-drop-session={owner}
          aria-label={label}
          aria-pressed={members.some((member) =>
            pressed.includes(member.chip.key),
          )}
        >
          <OwnerMark owner={owner} named={named} />
          <span className={styles.count}>{members.length}</span>
        </button>
      }
    />
  );
}

// chip이 이만큼을 넘으면 나머지는 +N 메뉴로 들어간다. tab이 쓸 폭을 지킨다. 주인 chip도 하나로 센다.
const SHOWN = 4;

export function FloatChips({
  global,
  desk,
  pressed,
  named = false,
  className,
  onToggleGlobal,
  onToggleDesk,
}: {
  readonly global: readonly FloatChip[];
  readonly desk: readonly FloatChip[];
  /** 지금 펴져 있는 chip의 key. 눌린 모양이다. */
  readonly pressed: readonly string[];
  /** 이름을 chip에 보인다. */
  readonly named?: boolean;
  readonly className?: string;
  readonly onToggleGlobal?: (key: string) => void;
  readonly onToggleDesk: (key: string) => void;
}) {
  const ownerOf = useOwners();
  const members = [
    ...global.map((chip) => ({ chip, global: true })),
    ...desk.map((chip) => ({ chip, global: false })),
  ];
  if (members.length === 0) return null;
  // key가 겹치지 않아 누른 key로 어느 쪽인지 가린다.
  const globalKeys = new Set(global.map((chip) => chip.key));
  const toggle = (key: string) =>
    globalKeys.has(key) ? onToggleGlobal?.(key) : onToggleDesk(key);
  // 목록에서 고른 것은 편다. 이미 펴져 있으면 그대로 둔다.
  const show = (key: string) => {
    if (!pressed.includes(key)) toggle(key);
  };
  const slots = slotsOf(members);
  const hidden = slots.slice(SHOWN);
  return (
    <div
      className={className}
      data-float-chips=""
      role="group"
      aria-label={t("shell.label.minimized")}
    >
      {slots.slice(0, SHOWN).map((slot) =>
        slot.kind === "owner" ? (
          <OwnerChip
            key={slotKey(slot)}
            owner={slot.owner}
            members={slot.members}
            named={named}
            pressed={pressed}
            onPick={show}
          />
        ) : (
          <Tooltip key={slotKey(slot)} content={slot.member.chip.title}>
            <button
              type="button"
              className={styles.chip}
              data-named={named || undefined}
              aria-label={slot.member.chip.title}
              aria-pressed={pressed.includes(slot.member.chip.key)}
              onClick={() => toggle(slot.member.chip.key)}
            >
              {slot.member.chip.icon}
              {slot.member.global ? globalMark : null}
              {named ? (
                <span className={styles.name}>
                  {slot.member.chip.label ?? slot.member.chip.title}
                </span>
              ) : null}
            </button>
          </Tooltip>
        ),
      )}
      {hidden.length === 0 ? null : (
        <Menu
          // 사람의 float은 누르면 펴고 접고, 주인 묶음 안에서 고른 것은 편다.
          onSelect={(key) =>
            slots.some(
              (slot) => slot.kind === "float" && slot.member.chip.key === key,
            )
              ? toggle(key)
              : show(key)
          }
          items={hidden.map((slot) =>
            slot.kind === "float"
              ? {
                  id: slot.member.chip.key,
                  label: slot.member.chip.title,
                  leading: <MenuIcon>{slot.member.chip.icon}</MenuIcon>,
                }
              : {
                  id: slotKey(slot),
                  label: t("shell.label.owner-chip", {
                    name: ownerOf(slot.owner).name,
                    count: slot.members.length,
                  }),
                  leading: (
                    <MenuIcon>
                      <OwnerMark owner={slot.owner} />
                    </MenuIcon>
                  ),
                  items: slot.members.map(memberItem),
                },
          )}
          trigger={
            <button
              type="button"
              className={styles.chip}
              data-minimized-more=""
              aria-label={t("shell.button.minimized-more", {
                count: hidden.length,
              })}
            >
              +{hidden.length}
            </button>
          }
        />
      )}
    </div>
  );
}
