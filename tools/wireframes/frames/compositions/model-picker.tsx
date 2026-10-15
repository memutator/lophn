// model 고르기 화면 조각. composer의 model picker(Favorites 묶음 → provider 묶음 → 고른 model의 option 축),
// option 축 묶음, 편집 form과 project 설정의 Model 칸(상속 표시·Changed·Reset). 목록과 option은 모두
// models-data.ts(catalog)에서 오고 여기에는 model 이름이 없다.
import { createContext, useContext, useState } from "react";
import {
  Button,
  Field,
  Icon,
  iconPixels,
  Popover,
  Select,
} from "@lophn/design/components";
import { paletteIcons } from "../../../../packages/shell/renderer/icons/mod.ts";

import menuStyles from "../../../../packages/design/components/menu/menu.module.css";
import {
  axesOf,
  initialSelection,
  type ModelSelection,
  providerOf,
  selectionLabel,
  withValue,
} from "./model-options.ts";
import { MODEL_CATALOG } from "./models-data.ts";
import t from "./agent-tab/agent-tab.module.css";
import { VendorIcon, vendorOf } from "../vendors/vendor-icon.tsx";
import a from "./agents.module.css";

/** 별표 찍은 model. 찍은 순서 그대로 둔다(provider로 다시 묶지 않는다). */
export const FAVORITE_START: readonly string[] = ["GPT-6.1 Sol", "Sonnet 5.5"];

export interface Favorites {
  readonly names: readonly string[];
  readonly toggle: (name: string) => void;
}

/** ProjectApp이 별표 상태를 들고 있어서 어느 Agent 탭의 picker에서 눌러도 같이 바뀐다. */
export const FavoritesContext = createContext<Favorites | null>(null);

function useFavorites(): Favorites {
  const shared = useContext(FavoritesContext);
  const [own, setOwn] = useState<readonly string[]>(FAVORITE_START);
  if (shared) return shared;
  return {
    names: own,
    toggle: (name) =>
      setOwn((now) =>
        now.includes(name)
          ? now.filter((item) => item !== name)
          : [...now, name]
      ),
  };
}

/** 고른 model의 option 축만 보인다. 없으면 없다고 말한다. */
export function OptionAxes(
  { selection, onChange }: {
    selection: ModelSelection;
    onChange: (axis: string, value: string) => void;
  },
) {
  const axes = axesOf(selection.model);
  if (axes.length === 0) {
    return <p className={a.modelNote}>No options for this model.</p>;
  }
  return (
    <div className={a.axes}>
      {axes.map((axis) => (
        <div key={axis.id} className={a.axis}>
          <div className={a.effortRow}>
            <span className={a.effortLabel}>{axis.label}</span>
            <div className={a.effort} role="group" aria-label={axis.label}>
              {axis.values.map((item) => {
                const on = selection.values[axis.id] === item.value;
                return (
                  <Button
                    key={item.value}
                    size="sm"
                    variant={on ? "secondary" : "ghost"}
                    aria-pressed={on}
                    onClick={() => onChange(axis.id, item.value)}
                  >
                    {item.value}
                  </Button>
                );
              })}
            </div>
          </div>
          {axis.note === undefined
            ? null
            : <p className={a.axisNote}>{axis.note}</p>}
        </div>
      ))}
    </div>
  );
}

/** provider 이름 옆의 vendor 아이콘. 모르는 이름이면 그리지 않는다. */
function ProviderIcon({ name }: { name: string }) {
  const vendor = vendorOf(name);
  return vendor === undefined ? null : <VendorIcon vendor={vendor} size={14} />;
}

function ModelRow(
  { name, provider, current, starred, onPick, onStar }: {
    name: string;
    provider?: string;
    current: boolean;
    starred: boolean;
    onPick: () => void;
    onStar: () => void;
  },
) {
  return (
    <div
      role="option"
      aria-selected={current}
      className={`${menuStyles.item} ${a.modelRow}`}
      data-highlighted={current ? "" : undefined}
      onClick={onPick}
    >
      <span className={a.modelCheck}>{current ? "✓" : ""}</span>
      <span className={a.modelName}>{name}</span>
      {provider === undefined
        ? null
        : <span className={a.modelProvider}>{provider}</span>}
      <button
        type="button"
        className={a.star}
        aria-label={starred
          ? `Remove ${name} from favorites`
          : `Add ${name} to favorites`}
        aria-pressed={starred}
        onClick={(event) => {
          event.stopPropagation();
          onStar();
        }}
      >
        {starred ? "★" : "☆"}
      </button>
    </div>
  );
}

/**
 * composer의 model picker. 위에서부터 검색칸, Favorites(별표 순서 그대로), provider 묶음, 고른 model의
 * option 축(고른 model이 가진 것만), 기본값 바꾸기. provider 이름 옆에 vendor 아이콘이 붙는다. 검색 중에도 Favorites가 먼저다.
 */
export function ModelPicker(
  { defaultOpen, selection, onSelection }: {
    defaultOpen: boolean;
    selection: ModelSelection;
    onSelection: (selection: ModelSelection) => void;
  },
) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const favorites = useFavorites();
  const needle = query.trim().toLowerCase();
  const matches = (name: string) =>
    needle === "" ||
    `${name} ${providerOf(name)}`.toLowerCase().includes(needle);
  const starred = favorites.names.filter(matches);
  const groups = MODEL_CATALOG.map((group) => ({
    ...group,
    models: group.models.filter((model) => matches(model.name)),
  })).filter((group) => group.models.length > 0);
  // 다른 model을 고르면 그 model의 기본 variant로 조용히 맞춘다.
  const pick = (name: string) => onSelection(initialSelection(name));
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" variant="ghost">
          {`${selectionLabel(selection)} ▾`}
        </Button>
      }
    >
      <div className={a.modelMenu}>
        <label className={a.modelSearch}>
          <Icon icon={paletteIcons.search} pixels={iconPixels("base")} />
          <input
            className={a.bareInput}
            aria-label="Search models"
            placeholder="Search models"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className={a.modelList} role="listbox" aria-label="Models">
          {starred.length === 0 && groups.length === 0
            ? <p className={a.noMatch}>No models match.</p>
            : null}
          {starred.length === 0 ? null : (
            <div role="presentation">
              <p className={a.modelGroup}>Favorites</p>
              {starred.map((name) => (
                <ModelRow
                  key={name}
                  name={name}
                  provider={providerOf(name)}
                  current={name === selection.model}
                  starred
                  onPick={() => pick(name)}
                  onStar={() => favorites.toggle(name)}
                />
              ))}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.provider} role="presentation">
              <p className={`${a.modelGroup} ${t.vendorHead}`}>
                <ProviderIcon name={group.provider} />
                {group.provider}
              </p>
              {group.models.map((model) => (
                <ModelRow
                  key={model.name}
                  name={model.name}
                  current={model.name === selection.model}
                  starred={favorites.names.includes(model.name)}
                  onPick={() => pick(model.name)}
                  onStar={() => favorites.toggle(model.name)}
                />
              ))}
            </div>
          ))}
        </div>
        <OptionAxes
          selection={selection}
          onChange={(axis, value) =>
            onSelection(withValue(selection, axis, value))}
        />
        <div className={a.modelFoot}>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Change defaults…
          </Button>
        </div>
      </div>
    </Popover>
  );
}

const INHERIT = "inherit";
const MODEL_CHOICES = MODEL_CATALOG.flatMap((group) =>
  group.models.map((model) => ({
    value: model.name,
    label: `${model.name} (${group.provider})`,
  }))
);

/**
 * Model 칸. 처음에는 위 층의 값을 따르고(`inherited`), 바꾸면 바뀐 칸만 저장된다는 뜻으로 Changed와 [Reset]이 붙는다.
 * 아래 option 축은 지금 model이 가진 것만 보인다.
 */
export function ModelField(
  { label, inheritLabel, inherited, value, onChange, overrideNote }: {
    label: string;
    /** "Use project default — Haiku 5.5 (from Workspace)" 같은 따르기 선택지의 글. */
    inheritLabel: string;
    inherited: ModelSelection;
    value: ModelSelection | null;
    onChange: (value: ModelSelection | null) => void;
    overrideNote?: string;
  },
) {
  const effective = value ?? inherited;
  return (
    <div className={a.modelField}>
      <Field label={label}>
        <Select
          options={[{ value: INHERIT, label: inheritLabel }, ...MODEL_CHOICES]}
          value={value === null ? INHERIT : value.model}
          onValueChange={(next) =>
            onChange(
              next === INHERIT
                ? null
                : next === effective.model && value !== null
                ? value
                : initialSelection(next),
            )}
        />
      </Field>
      <div className={a.fieldAxes}>
        <OptionAxes
          selection={effective}
          onChange={(axis, next) => onChange(withValue(effective, axis, next))}
        />
      </div>
      {value === null ? null : (
        <p className={a.changedRow}>
          <span className={a.changed}>Changed</span>
          {overrideNote === undefined
            ? null
            : <span className={a.changedNote}>{overrideNote}</span>}
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Reset
          </Button>
        </p>
      )}
    </div>
  );
}
