export type EquipmentCategory = "camera_lens" | "light" | "eng_set" | "live";
export type EquipmentLoanStatus = "borrowed" | "returned";
export type EquipmentLoanType = "normal" | "live" | "eng_set";

export interface EquipmentItem {
  id: string;
  category: EquipmentCategory;
  groupName: string;
  name: string;
  code: string;
  sortOrder: number;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentLoan {
  id: string;
  borrowerProfileId: string;
  borrowerName: string;
  borrowedAt: string;
  returnedAt: string | null;
  status: EquipmentLoanStatus;
  loanType: EquipmentLoanType;
  liveTrs: string | null;
  liveCameraReporter: string | null;
  liveAudioMan: string | null;
  liveLocation: string | null;
  liveNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentLoanItem {
  id: string;
  loanId: string;
  equipmentItemId: string;
  borrowedAt: string;
  returnedAt: string | null;
  status: EquipmentLoanStatus;
  item: EquipmentItem;
  loan: EquipmentLoan;
}

export interface EquipmentProfile {
  id: string;
  name: string;
  role?: string;
  approved?: boolean;
}

export interface LiveLoanDetails {
  trs: string;
  cameraReporter: string;
  audioMan: string;
  location: string;
  note: string;
}

export interface EquipmentCategoryConfig {
  category: EquipmentCategory;
  title: string;
  eyebrow: string;
  description: string;
  route: string;
}

export const equipmentCategoryConfigs = {
  camera_lens: {
    category: "camera_lens",
    title: "카메라/렌즈",
    eyebrow: "CAMERA",
    description: "바디, 렌즈, 배터리와 단독 카메라를 대여/반납합니다.",
    route: "/equipment/camera",
  },
  light: {
    category: "light",
    title: "조명",
    eyebrow: "LIGHT",
    description: "조명 장비의 현재 대여 상태와 일별 기록을 확인합니다.",
    route: "/equipment/light",
  },
  eng_set: {
    category: "eng_set",
    title: "ENG SET",
    eyebrow: "ENG SET",
    description: "회원별 ENG SET을 대여하고 근무표 기준 상태를 함께 확인합니다.",
    route: "/equipment/eng-set",
  },
  live: {
    category: "live",
    title: "라이브장비",
    eyebrow: "LIVE",
    description: "TVU와 기타 라이브 장비를 대여/반납합니다.",
    route: "/equipment/live",
  },
} satisfies Record<EquipmentCategory, EquipmentCategoryConfig>;

export const equipmentCategoryLabels: Record<EquipmentCategory, string> = {
  camera_lens: "카메라/렌즈",
  light: "조명",
  eng_set: "ENG SET",
  live: "라이브장비",
};

export const equipmentNavItems = [
  { href: "/equipment/camera", label: "카메라/렌즈" },
  { href: "/equipment/light", label: "조명" },
  { href: "/equipment/eng-set", label: "ENG SET" },
  { href: "/equipment/live", label: "라이브장비" },
  { href: "/equipment/status", label: "장비대여현황" },
  { href: "/equipment/live-status", label: "라이브장비현황" },
] as const;

export const normalEquipmentCategories: EquipmentCategory[] = ["camera_lens", "light", "eng_set"];

