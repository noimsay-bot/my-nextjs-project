import { CategoryDefinition, PointerState, ScheduleState } from "@/lib/schedule/types";

export const STORAGE_KEY = "j-schedule-integrated-react-v1";

export const categories: CategoryDefinition[] = [
  { key: "morning", label: "조근" },
  { key: "extension", label: "연장" },
  { key: "evening", label: "석근" },
  { key: "nightWeekday", label: "월~목 야근" },
  { key: "nightFriday", label: "금요일 야근" },
  { key: "nightSaturday", label: "토요일 야근" },
  { key: "nightSunday", label: "일요일 야근" },
  { key: "jcheck", label: "제크" },
  { key: "holidayDuty", label: "휴일근무" },
];

export const seedOrders = {
  extension: ["반일훈", "정재우", "변경태", "박재현", "황현우", "유연경", "구본준", "김진광", "정철원", "이지수", "김재식", "유규열", "김준택", "이주원", "정상원", "이현일", "이학진", "박대권", "이완근", "조용희", "방극철", "", "", "", "", "", "", "", "", ""],
  morning: ["이주원", "이지수", "방극철", "김준택", "김재식", "정재우", "반일훈", "변경태", "구본준", "유규열", "박재현", "유연경", "정상원", "김진광", "박대권", "정철원", "이학진", "이완근", "조용희", "황현우", "이현일", "", "", "", "", "", "", "", "", ""],
  evening: ["유규열", "김재식", "박재현", "유연경", "정상원", "김진광", "박대권", "정철원", "이학진", "이완근", "황현우", "이현일", "이주원", "이지수", "방극철", "김준택", "정재우", "반일훈", "변경태", "조용희", "구본준", "", "", "", "", "", "", "", "", ""],
  nightWeekday: ["정철원", "황현우", "김재식", "정재우", "반일훈", "정상원", "방극철", "이학진", "김준택", "변경태", "이지수", "박재현", "박대권", "이현일", "유연경", "유규열", "김진광", "이주원", "구본준", "이완근", "조용희", "", "", "", "", "", "", "", "", ""],
  holidayDuty: ["김재식", "이지수", "박재현", "황현우", "유규열", "이주원", "정철원", "반일훈", "변경태", "정재우", "이학진", "구본준", "신동환", "정상원", "유연경", "이동현", "김준택", "김진광", "박대권", "이완근", "방극철", "조용희", "이현일", "", "", "", "", "", "", ""],
  nightFriday: ["유규열", "박재현", "박대권", "김준택", "정재우", "정철원", "이현일", "변경태", "이학진", "황현우", "이지수", "구본준", "김재식", "반일훈", "유연경", "조용희", "방극철", "정상원", "이주원", "이완근", "김진광", "", "", "", "", "", "", "", "", ""],
  nightSaturday: ["김진광", "이학진", "김준택", "이지수", "이완근", "방극철", "김재식", "이주원", "정재우", "정철원", "구본준", "반일훈", "정상원", "박대권", "유규열", "유연경", "이동현", "조용희", "황현우", "변경태", "이현일", "신동환", "박재현", "", "", "", "", "", "", ""],
  nightSunday: ["변경태", "김진광", "황현우", "정상원", "정철원", "조용희", "이완근", "구본준", "방극철", "반일훈", "박재현", "이지수", "박대권", "이주원", "정재우", "이현일", "이학진", "김재식", "유규열", "김준택", "유연경", "", "", "", "", "", "", "", "", ""],
  jcheck: ["김미란", "이현일", "반일훈", "유규열", "이완근", "김진광", "변경태", "박대권", "김준택", "정철원", "방극철", "황현우", "최무룡", "장후원", "신동환", "이학진", "이지수", "조용희", "정재우", "정상원", "이주원", "유연경", "박재현", "김재식", "구본준", "", "", "", "", ""],
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

export const defaultScheduleState: ScheduleState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  jcheckCount: 1,
  extraHolidays: "",
  vacations: "",
  offPeople: [],
  orders: seedOrders,
  pointers: defaultPointers,
  generated: null,
  generatedHistory: [],
  snapshots: {},
  currentUser: "정철원",
  showMyWork: false,
  editDateKey: null,
  selectedPerson: null,
};
