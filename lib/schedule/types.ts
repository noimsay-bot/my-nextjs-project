export type CategoryKey =
  | "morning"
  | "extension"
  | "evening"
  | "nightWeekday"
  | "nightFriday"
  | "nightSaturday"
  | "nightSunday"
  | "jcheck"
  | "holidayDuty";

export interface CategoryDefinition {
  key: CategoryKey;
  label: string;
}

export interface Conflict {
  category: string;
  name: string;
}

export type VacationType = "연차" | "대휴" | "기타";
export type ScheduleAssignmentNameTag = "gov" | "law";

export interface DaySchedule {
  dateKey: string;
  day: number;
  month: number;
  year: number;
  dow: number;
  isWeekend: boolean;
  isHoliday: boolean;
  isCustomHoliday: boolean;
  isWeekdayHoliday: boolean;
  isOverflowMonth: boolean;
  vacations: string[];
  assignments: Record<string, string[]>;
  assignmentNameTags?: Record<string, ScheduleAssignmentNameTag>;
  manualExtras: string[];
  headerName: string;
  conflicts: Conflict[];
}

export interface GeneratedSchedule {
  year: number;
  month: number;
  monthKey: string;
  days: DaySchedule[];
  nextPointers: PointerState;
  nextStartDate: string;
}

export interface SnapshotItem {
  id: string;
  label: string;
  createdAt: string;
  generated: GeneratedSchedule;
}

export interface SelectedPerson {
  dateKey: string;
  category: string;
  index: number;
}

export interface SchedulePersonRef {
  monthKey: string;
  dateKey: string;
  category: string;
  index: number;
  name: string;
}

export type ScheduleChangeRequestStatus = "pending" | "accepted" | "rejected" | "rolledBack";

export type ScheduleChangeRequestAction = "created" | "accepted" | "rejected" | "rolledBack";

export interface ScheduleChangeRequestLogEntry {
  action: ScheduleChangeRequestAction;
  at: string;
  by: string;
}

export interface ScheduleChangeRequestAppliedState {
  scheduleMonths: GeneratedSchedule[];
  publishedMonths: GeneratedSchedule[];
}

export interface ScheduleChangeRequest {
  id: string;
  monthKey: string;
  requesterId: string;
  requesterName: string;
  source: SchedulePersonRef;
  target: SchedulePersonRef;
  route: SchedulePersonRef[];
  hasConflictWarning: boolean;
  status: ScheduleChangeRequestStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  rolledBackAt: string | null;
  rolledBackBy: string | null;
  appliedState: ScheduleChangeRequestAppliedState | null;
  history: ScheduleChangeRequestLogEntry[];
}

export interface ScheduleNameObject {
  key: string;
  name: string;
  ref: SchedulePersonRef;
  pending: boolean;
}

export interface ScheduleState {
  year: number;
  month: number;
  jcheckCount: number;
  extraHolidays: string;
  vacations: string;
  generalTeamPeople: string[];
  globalOffPool: string[];
  offPeople: string[];
  offByCategory: Record<CategoryKey, string[]>;
  offExcludeByCategory: Record<CategoryKey, string[]>;
  orders: Record<CategoryKey, string[]>;
  pointers: PointerState;
  monthStartPointers: Record<string, PointerState>;
  monthStartNames: Record<string, Partial<Record<CategoryKey, string>>>;
  pendingSnapshotMonthKey: string | null;
  generated: GeneratedSchedule | null;
  generatedHistory: GeneratedSchedule[];
  snapshots: Record<string, SnapshotItem[]>;
  currentUser: string;
  showMyWork: boolean;
  editDateKey: string | null;
  editingMonthKey: string | null;
  selectedPerson: SelectedPerson | null;
}

export type PointerState = Record<CategoryKey, number>;

export interface MessageState {
  tone: "ok" | "warn" | "note";
  text: string;
}

export interface GenerationResult {
  state: ScheduleState;
  warningCount: number;
  message: string;
}
