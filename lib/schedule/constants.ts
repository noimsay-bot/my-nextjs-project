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

const assignmentDisplayOrder = [
  "조근",
  "연장",
  "일반",
  "석근",
  "야근",
  "제크",
  "휴가",
  "국회",
  "청사",
  "청와대",
  "주말조근",
  "주말일반근무",
  "뉴스대기",
] as const;

export function getAssignmentDisplayRank(category: string) {
  const normalized = getScheduleCategoryLabel(category);
  const index = assignmentDisplayOrder.indexOf(normalized as (typeof assignmentDisplayOrder)[number]);
  if (index >= 0) return index;
  const rawIndex = assignmentDisplayOrder.indexOf(category as (typeof assignmentDisplayOrder)[number]);
  return rawIndex >= 0 ? rawIndex : assignmentDisplayOrder.length + 1;
}

export const categories: CategoryDefinition[] = [
  { key: "morning", label: "조근" },
  { key: "extension", label: "연장" },
  { key: "evening", label: "석근" },
  { key: "nightWeekday", label: "평일 야근" },
  { key: "nightFriday", label: "금요 야근" },
  { key: "nightSaturday", label: "토요 야근" },
  { key: "nightSunday", label: "일요 야근" },
  { key: "jcheck", label: "제크" },
  { key: "holidayDuty", label: "휴일 근무" },
];

export const orderCategories = categories.filter((category) => category.key !== "jcheck");

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
  extension: createSeedList(
    "반일훈",
    "정재우",
    "변경태",
    "박재현",
    "황현우",
    "유연경",
    "구본준",
    "김진광",
    "정철원",
    "이지수",
    "김재식",
    "유규열",
    "김준택",
    "이주원",
    "정상원",
    "이현일",
    "이학진",
    "박대권",
    "이완근",
    "조용희",
    "방극철",
  ),
  morning: createSeedList(
    "이주원",
    "이지수",
    "방극철",
    "김준택",
    "김재식",
    "정재우",
    "반일훈",
    "변경태",
    "구본준",
    "유규열",
    "박재현",
    "유연경",
    "정상원",
    "김진광",
    "박대권",
    "정철원",
    "이학진",
    "이완근",
    "조용희",
    "황현우",
    "이현일",
  ),
  evening: createSeedList(
    "유규열",
    "김재식",
    "박재현",
    "유연경",
    "정상원",
    "김진광",
    "박대권",
    "정철원",
    "이학진",
    "이완근",
    "황현우",
    "이현일",
    "이주원",
    "이지수",
    "방극철",
    "김준택",
    "정재우",
    "반일훈",
    "변경태",
    "조용희",
    "구본준",
  ),
  nightWeekday: createSeedList(
    "정철원",
    "황현우",
    "김재식",
    "정재우",
    "반일훈",
    "정상원",
    "방극철",
    "이학진",
    "김준택",
    "변경태",
    "이지수",
    "박재현",
    "박대권",
    "이현일",
    "유연경",
    "유규열",
    "김진광",
    "이주원",
    "구본준",
    "이완근",
    "조용희",
    "조용희",
    "이현일",
  ),
  holidayDuty: createSeedList(
    "김재식",
    "이지수",
    "박재현",
    "황현우",
    "유규열",
    "이주원",
    "정철원",
    "반일훈",
    "변경태",
    "정재우",
    "이학진",
    "구본준",
    "신동환",
    "정상원",
    "유연경",
    "이동현",
    "김준택",
    "김진광",
    "박대권",
    "이완근",
    "방극철",
    "조용희",
    "이현일",
  ),
  nightFriday: createSeedList(
    "유규열",
    "박재현",
    "박대권",
    "김준택",
    "정재우",
    "정철원",
    "이현일",
    "변경태",
    "이학진",
    "황현우",
    "이지수",
    "구본준",
    "김재식",
    "반일훈",
    "유연경",
    "조용희",
    "방극철",
    "정상원",
    "이주원",
    "이완근",
    "김진광",
  ),
  nightSaturday: createSeedList(
    "김진광",
    "이학진",
    "김준택",
    "이지수",
    "이완근",
    "방극철",
    "김재식",
    "이주원",
    "정재우",
    "정철원",
    "구본준",
    "반일훈",
    "정상원",
    "박대권",
    "유규열",
    "유연경",
    "이동현",
    "조용희",
    "황현우",
    "변경태",
    "이현일",
    "신동환",
    "박재현",
  ),
  nightSunday: createSeedList(
    "변경태",
    "김진광",
    "황현우",
    "정상원",
    "정철원",
    "조용희",
    "이완근",
    "구본준",
    "방극철",
    "반일훈",
    "박재현",
    "이지수",
    "박대권",
    "이주원",
    "정재우",
    "이현일",
    "이학진",
    "김재식",
    "유규열",
    "김준택",
    "유연경",
  ),
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
  offExcludeByCategory: createEmptyOffByCategory(),
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
  editingMonthKey: null,
  selectedPerson: null,
};
