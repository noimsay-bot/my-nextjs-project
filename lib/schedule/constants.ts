import { CategoryDefinition, CategoryKey, PointerState, ScheduleState } from "@/lib/schedule/types";

export const STORAGE_KEY = "j-schedule-integrated-react-v1";
export const SCHEDULE_YEAR_START = 2026;
export const SCHEDULE_YEAR_END = 2056;
export const SCHEDULE_YEARS = Array.from(
  { length: SCHEDULE_YEAR_END - SCHEDULE_YEAR_START + 1 },
  (_, index) => SCHEDULE_YEAR_START + index,
);
export const SCHEDULE_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
export const DEFAULT_JCHECK_COUNT = 1;

export function getScheduleCategoryLabel(category: string) {
  if (category === "주말조근") return "조근";
  if (category === "주말일반근무") return "일반";
  if (category === "일반") return "석근";
  return category;
}

export const categories: CategoryDefinition[] = [
  { key: "morning", label: "조근" },
  { key: "extension", label: "연장" },
  { key: "evening", label: "석근" },
  { key: "nightWeekday", label: "평일 야근" },
  { key: "nightFriday", label: "금요일 야근" },
  { key: "nightSaturday", label: "토요일 야근" },
  { key: "nightSunday", label: "일요일 야근" },
  { key: "jcheck", label: "제크" },
  { key: "holidayDuty", label: "휴일 근무" },
];

export function createEmptyOffByCategory(): Record<CategoryKey, string[]> {
  return categories.reduce(
    (accumulator, category) => {
      accumulator[category.key] = [];
      return accumulator;
    },
    {} as Record<CategoryKey, string[]>,
  );
}

export const emptyOffByCategory = createEmptyOffByCategory();

function createSeedList(...names: string[]) {
  return Array.from({ length: 30 }, (_, index) => names[index] ?? "");
}

export const seedOrders = {
  extension: createSeedList(),
  morning: createSeedList(),
  evening: createSeedList(),
  nightWeekday: createSeedList(),
  holidayDuty: createSeedList(),
  nightFriday: createSeedList(),
  nightSaturday: createSeedList(),
  nightSunday: createSeedList(),
  jcheck: createSeedList(),
} satisfies Record<CategoryDefinition["key"], string[]>;

export const defaultPointers: PointerState = {
  morning: 1,
  extension: 1,
  evening: 1,
  nightWeekday: 1,
  nightFriday: 1,
  nightSaturday: 1,
  nightSunday: 1,
  jcheck: 1,
  holidayDuty: 1,
};

const currentYear = new Date().getFullYear();
const defaultYear = SCHEDULE_YEARS.includes(currentYear) ? currentYear : SCHEDULE_YEAR_START;
const currentMonth = new Date().getMonth() + 1;

export const defaultScheduleState: ScheduleState = {
  year: defaultYear,
  month: currentMonth,
  jcheckCount: DEFAULT_JCHECK_COUNT,
  extraHolidays: "",
  vacations: "",
  offPeople: [],
  offByCategory: createEmptyOffByCategory(),
  orders: seedOrders,
  pointers: defaultPointers,
  monthStartPointers: {},
  monthStartNames: {},
  pendingSnapshotMonthKey: null,
  generated: null,
  generatedHistory: [],
  snapshots: {},
  currentUser: "",
  showMyWork: false,
  editDateKey: null,
  selectedPerson: null,
};
