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
  isUnderRepair: boolean;
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

export interface LiveEquipmentStatusEntry extends LiveLoanDetails {
  equipmentItemId: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface LiveEquipmentStatusSaveEntry extends LiveLoanDetails {
  equipmentItemId: string;
}

export interface EquipmentCategoryConfig {
  category: EquipmentCategory;
  title: string;
  eyebrow: string;
  route: string;
}

export const equipmentCategoryConfigs = {
  camera_lens: {
    category: "camera_lens",
    title: "카메라/렌즈",
    eyebrow: "CAMERA",
    route: "/equipment/camera",
  },
  light: {
    category: "light",
    title: "조명",
    eyebrow: "LIGHT",
    route: "/equipment/light",
  },
  eng_set: {
    category: "eng_set",
    title: "ENG SET",
    eyebrow: "ENG SET",
    route: "/equipment/eng-set",
  },
  live: {
    category: "live",
    title: "라이브장비",
    eyebrow: "LIVE",
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
  { href: "/equipment/live", label: "라이브장비" },
  { href: "/equipment/camera", label: "카메라/렌즈" },
  { href: "/equipment/eng-set", label: "ENG SET" },
  { href: "/equipment/light", label: "조명" },
  { href: "/equipment/status", label: "장비대여현황" },
  { href: "/equipment/live-status", label: "라이브장비현황" },
] as const;

export const normalEquipmentCategories: EquipmentCategory[] = ["camera_lens", "light", "eng_set"];
