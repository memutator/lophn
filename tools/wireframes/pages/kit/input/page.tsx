// Kit · input. @lophn/ui/input의 component와 예제(control-sizes, orders-filters).
import { useContext, useState } from "react";
import {
  AttachmentChip,
  AttachmentTile,
  Calendar,
  Checkbox,
  DatePicker,
  DateRangePicker,
  type DaySpan,
  Field,
  FieldContext,
  Input,
  SearchSelect,
  SegmentedControl,
  Select,
  SwatchPicker,
  Switch,
  Textarea,
  TimePicker,
} from "@lophn/ui/input";

import { FileIcon } from "@lophn/ui/primitives";

import { ControlSizes } from "./control-sizes.tsx";
import { OrdersFilters } from "./orders-filters.tsx";
import { Example, kit, Page, Section } from "../kit.tsx";

const EXAMPLE_NOW = new Date("2026-10-06T15:30:00Z");
// 견본 그림. 바깥 파일 없이 그린다.
const SAMPLE_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#2a78d6"/><circle cx="40" cy="40" r="18" fill="#fab219"/></svg>',
)}`;
const NOOP = () => {};
// 긴 목록 견본: 설치된 글꼴처럼 수십 개.
const FONT_FAMILIES = [
  "D2Coding",
  "DejaVu Sans",
  "DejaVu Sans Mono",
  "Fira Code",
  "Hack",
  "IBM Plex Sans",
  "Inter",
  "JetBrains Mono",
  "MaruBuri",
  "Nanum Gothic",
  "Noto Sans",
  "Noto Sans CJK KR",
  "Noto Serif CJK KR",
  "Pretendard",
  "Sarasa Mono K",
  "Sarasa Term K",
].map((family) => ({ value: family, label: family }));

// Field가 넘기는 id·오류 상태를 FieldContext로 읽어 보이는 최소 입력.
function ContextReader() {
  const field = useContext(FieldContext);
  if (field === null) return null;
  return (
    <>
      <input id={field.id} aria-invalid={field.invalid} />
      <span className={kit.mono}>invalid: {String(field.invalid)}</span>
    </>
  );
}

const SWATCHES = [
  {
    value: "ink",
    label: "Ink",
    swatch: "linear-gradient(135deg, #1a1a18 50%, #f3f3f0 50%)",
  },
  {
    value: "blue",
    label: "Blue",
    swatch: "linear-gradient(135deg, #1d5bbf 50%, #7db0f2 50%)",
  },
  {
    value: "green",
    label: "Green",
    swatch: "linear-gradient(135deg, #1b7a3c 50%, #6fcb8b 50%)",
  },
];

const STATUSES = [
  { value: "complete", label: "Complete" },
  { value: "incomplete", label: "Incomplete" },
  { value: "pending", label: "Pending" },
];

const VIEWS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year", disabled: true },
];

export function KitInput() {
  const [swatch, setSwatch] = useState("blue");
  const [status, setStatus] = useState("complete");
  const [view, setView] = useState("week");
  const [day, setDay] = useState("2026-10-09");
  const [font, setFont] = useState("D2Coding");
  const [due, setDue] = useState("");
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const [reminder, setReminder] = useState("");
  const [span, setSpan] = useState<DaySpan | undefined>({
    from: "2026-10-12",
    to: "2026-10-16",
  });
  const options = [
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly", disabled: true },
  ];
  return (
    <Page>
      <div className={kit.colTwo}>
        <Section title="Input">
          <div className={kit.column}>
            <div className={kit.field}>
              <Field label="Project name" help="Letters, numbers and dashes.">
                <Input placeholder="phroner" />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Project name" error="That name is already used.">
                <Input defaultValue="phroner" />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Disabled">
                <Input defaultValue="Read only" disabled />
              </Field>
            </div>
            {(["sm", "md", "lg"] as const).map((size) => (
              <div key={size} className={kit.field}>
                <Field label={`Size ${size}`}>
                  <Input size={size} defaultValue={size} />
                </Field>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Textarea and Select">
          <div className={kit.column}>
            <div className={kit.field}>
              <Field label="Purpose" help="One or two sentences.">
                <Textarea
                  rows={3}
                  defaultValue="Keep the monthly food spending under the plan."
                />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Purpose" error="Write at least one sentence.">
                <Textarea rows={2} />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Notes">
                <Textarea rows={2} defaultValue="Locked." disabled />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Repeat">
                <Select options={options} defaultValue="weekly" />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Repeat" error="Pick how often.">
                <Select options={options} placeholder="Choose" />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Disabled select">
                <Select options={options} defaultValue="daily" disabled />
              </Field>
            </div>
          </div>
        </Section>
      </div>
      <Section title="Checkbox and Switch">
        <div className={kit.colTwo}>
          <div className={kit.column}>
            <Checkbox label="Track Markdown files" defaultChecked />
            <Checkbox label="Use .gitignore" />
            <Checkbox label="Disabled, checked" defaultChecked disabled />
            <Checkbox label="Disabled" disabled />
          </div>
          <div className={kit.column}>
            <Switch label="Show line numbers" defaultChecked />
            <Switch label="Wrap long lines" />
            <Switch label="Disabled, on" defaultChecked disabled />
            <Switch label="Disabled" disabled />
          </div>
        </div>
      </Section>
      <Section
        title="SegmentedControl"
        note="두세 개 가운데 하나를 늘 펼쳐 고른다. 칸 폭은 같고 높이는 같은 size의 Button과 같다. 방향키로 옮긴다."
      >
        <div className={kit.column}>
          <SegmentedControl
            label="Status"
            options={STATUSES}
            value={status}
            onValueChange={setStatus}
          />
          <SegmentedControl
            label="View"
            size="sm"
            options={VIEWS}
            value={view}
            onValueChange={setView}
          />
          <div className={kit.field}>
            <Field label="Repeat" help="In a Field the group takes the label.">
              <SegmentedControl
                label="Repeat"
                options={options}
                value="weekly"
                onValueChange={() => {}}
              />
            </Field>
          </div>
        </div>
      </Section>
      <Section
        title="SearchSelect"
        note="Select와 같은 칸이고, 열면 목록 위 검색 칸에 focus가 간다. 위아래 화살표로 옮기고 Enter로 고른다. 목록 밖의 저장 값은 note를 붙인 줄로 앞에 둔다."
      >
        <div className={kit.colTwo}>
          <div className={kit.field}>
            <Field label="UI font">
              <SearchSelect
                label="UI font"
                options={FONT_FAMILIES}
                value={font}
                onValueChange={setFont}
              />
            </Field>
          </div>
          <div className={kit.field}>
            <Field label="Code font">
              <SearchSelect
                label="Code font"
                options={[
                  {
                    value: "Berkeley Mono",
                    label: "Berkeley Mono",
                    note: "Not installed",
                  },
                  ...FONT_FAMILIES,
                ]}
                value="Berkeley Mono"
                onValueChange={NOOP}
              />
            </Field>
          </div>
        </div>
      </Section>
      <Section
        title="Calendar"
        note="날짜를 고르는 달력 한 장. 오늘은 테두리, 고른 날은 ink, 기간 사이는 selection 색이다. min·max 밖은 누를 수 없다."
      >
        <div className={kit.colTwo}>
          <Calendar selected={day} onPick={setDay} now={EXAMPLE_NOW} />
          <Calendar
            selected={{ from: "2026-10-12", to: "2026-10-16" }}
            onPick={() => {}}
            now={EXAMPLE_NOW}
            min="2026-10-05"
            max="2026-10-28"
          />
        </div>
      </Section>
      <Section
        title="DatePicker and DateRangePicker"
        note="Select와 같은 칸이고 누르면 Calendar가 뜬다. 기간은 두 번 눌러 양 끝을 고른다."
      >
        <div className={kit.colTwo}>
          <div className={kit.column}>
            <div className={kit.field}>
              <Field label="Due date">
                <DatePicker
                  value={due}
                  onValueChange={setDue}
                  now={EXAMPLE_NOW}
                />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Start date" error="Pick a date after today.">
                <DatePicker
                  value="2026-10-01"
                  onValueChange={() => {}}
                  now={EXAMPLE_NOW}
                />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Disabled date">
                <DatePicker
                  value="2026-10-06"
                  onValueChange={() => {}}
                  now={EXAMPLE_NOW}
                  disabled
                />
              </Field>
            </div>
          </div>
          <div className={kit.column}>
            <div className={kit.field}>
              <Field label="Trip">
                <DateRangePicker
                  value={span}
                  onValueChange={setSpan}
                  now={EXAMPLE_NOW}
                />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Leave" help="Nothing picked yet.">
                <DateRangePicker
                  value={undefined}
                  onValueChange={() => {}}
                  now={EXAMPLE_NOW}
                  size="sm"
                />
              </Field>
            </div>
          </div>
        </div>
      </Section>
      <Section
        title="TimePicker"
        note="Select와 같은 칸이고 누르면 step 간격 시각 목록이 뜬다. 열면 고른 시각이 가운데에 온다. 끝 시각은 from에 시작 시각을 넘겨 시작 다음 칸부터 길이와 같이 보인다."
      >
        <div className={kit.colTwo}>
          <div className={kit.column}>
            <div className={kit.row}>
              <Field label="Date">
                <DatePicker
                  value={day}
                  onValueChange={setDay}
                  now={EXAMPLE_NOW}
                />
              </Field>
              <Field label="Starts">
                <TimePicker
                  value={start}
                  onValueChange={setStart}
                  now={EXAMPLE_NOW}
                />
              </Field>
              <Field label="Ends">
                <TimePicker
                  value={end}
                  onValueChange={setEnd}
                  now={EXAMPLE_NOW}
                  from={start}
                />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Remind at" help="Every 30 minutes.">
                <TimePicker
                  value={reminder}
                  onValueChange={setReminder}
                  now={EXAMPLE_NOW}
                  step={30}
                />
              </Field>
            </div>
          </div>
          <div className={kit.column}>
            <div className={kit.field}>
              <Field label="Ends" error="Pick a time after the start.">
                <TimePicker
                  value="09:00"
                  onValueChange={NOOP}
                  now={EXAMPLE_NOW}
                />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Disabled time">
                <TimePicker
                  value="14:30"
                  onValueChange={NOOP}
                  now={EXAMPLE_NOW}
                  disabled
                />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Size sm, 24-hour locale">
                <TimePicker
                  value="18:45"
                  onValueChange={NOOP}
                  now={EXAMPLE_NOW}
                  locale="en-GB"
                  size="sm"
                />
              </Field>
            </div>
          </div>
        </div>
      </Section>
      <Section
        title="SwatchPicker"
        note="견본이 곧 선택지다. 고른 견본에 바깥 고리가 생기고 방향키로 옮긴다."
      >
        <Field label="Accent">
          <SwatchPicker
            label="Accent"
            options={SWATCHES}
            value={swatch}
            onValueChange={setSwatch}
          />
        </Field>
      </Section>
      <Section
        title="FieldContext"
        note="Field가 자식에게 id와 오류 상태를 넘긴다. 새 입력 control이 이 context를 읽는다."
      >
        <div className={kit.colTwo}>
          <Field label="Context, valid" help="id를 label과 잇는다.">
            <ContextReader />
          </Field>
          <Field label="Context, invalid" error="invalid가 true가 된다.">
            <ContextReader />
          </Field>
        </div>
      </Section>
      <Section
        title="AttachmentChip and AttachmentTile"
        note="보낼 말에 붙인 파일과 이미지. 붙이는 중에는 [x]가 있고 보낸 뒤에는 없다."
      >
        <div className={kit.row}>
          <AttachmentChip
            name="chest-layout.md"
            icon={<FileIcon name="chest-layout.md" size={16} />}
            path="/home/me/phroner/docs/chest-layout.md"
            onRemove={NOOP}
            removeLabel="Remove chest-layout.md"
          />
          <AttachmentChip
            name="report.pdf"
            icon={<FileIcon name="report.pdf" size={16} />}
            onOpen={NOOP}
          />
          <AttachmentTile
            src={SAMPLE_IMAGE}
            alt="screenshot.png"
            onOpen={NOOP}
            onRemove={NOOP}
            removeLabel="Remove screenshot.png"
          />
          <AttachmentTile src={SAMPLE_IMAGE} alt="sent.png" />
        </div>
      </Section>
      <Section
        title="control-sizes"
        note="sm·md·lg 높이의 Button·Input·Select를 같은 줄에 맞춘다. 마지막 줄은 touch density(phone)의 md다."
      >
        <Example>
          <div className={kit.panel}>
            <ControlSizes />
          </div>
        </Example>
      </Section>
      <Section
        title="orders-filters"
        note="기간(DateRangeFilter)·창고 하나(SelectFilter)·상태 여럿(MultiSelectFilter)·검색으로 read command의 입력을 만든다."
      >
        <Example>
          <div className={kit.panel}>
            <OrdersFilters now={EXAMPLE_NOW} call={() => Promise.resolve()} />
          </div>
        </Example>
      </Section>
    </Page>
  );
}
