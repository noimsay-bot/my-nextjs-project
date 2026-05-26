export type ElectionStatus = "draft" | "published" | "closed";
export type ElectionEquipmentType = "seoul" | "regional" | "rental" | "car" | "none" | "";
export type ElectionCellColorKey =
  | "place"
  | "poolVideo"
  | "equipmentName"
  | "trs"
  | "cameraStaff"
  | "audioStaff"
  | "liveTime"
  | "reporter"
  | "address"
  | "note"
  | "livePosition"
  | "lighting";
export type ElectionCellColors = Partial<Record<ElectionCellColorKey, string>>;

export interface ElectionPoint {
  id: string;
  eventId: string;
  sortOrder: number;
  region: string;
  place: string;
  poolVideo: string;
  equipmentName: string;
  equipmentType: ElectionEquipmentType | string;
  trs: string;
  cameraStaffName: string;
  cameraStaffUserId: string | null;
  cameraStaffNamePm: string;
  cameraStaffUserIdPm: string | null;
  audioStaffName: string;
  audioStaffUserId: string | null;
  audioStaffNamePm: string;
  reporterName: string;
  reporterUserId: string | null;
  reporterNamePm: string;
  liveTime: string;
  liveTimePm: string;
  address: string;
  note: string;
  livePosition: string;
  lighting: string;
  regionColor: string;
  cellColors: ElectionCellColors;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ElectionEvent {
  id: string;
  title: string;
  electionDate: string;
  status: ElectionStatus;
  publishedAt: string | null;
  publishedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  points: ElectionPoint[];
}

export interface ElectionProfileOption {
  id: string;
  name: string;
  role: string;
}

export interface ElectionWorkspace {
  event: ElectionEvent | null;
  archivedEvents: ElectionEvent[];
  profiles: ElectionProfileOption[];
  canManage: boolean;
}

export interface ElectionPointInput {
  id?: string;
  sortOrder: number;
  region: string;
  place: string;
  poolVideo: string;
  equipmentName: string;
  equipmentType: ElectionEquipmentType | string;
  trs: string;
  cameraStaffName: string;
  cameraStaffUserId: string | null;
  cameraStaffNamePm: string;
  cameraStaffUserIdPm: string | null;
  audioStaffName: string;
  audioStaffUserId: string | null;
  audioStaffNamePm: string;
  reporterName: string;
  reporterUserId: string | null;
  reporterNamePm: string;
  liveTime: string;
  liveTimePm: string;
  address: string;
  note: string;
  livePosition: string;
  lighting: string;
  regionColor: string;
  cellColors: ElectionCellColors;
  isActive: boolean;
}

export interface ElectionSaveInput {
  id: string | null;
  title: string;
  electionDate: string;
  points: ElectionPointInput[];
}

export interface ElectionTvuOverlay {
  eventId: string;
  eventTitle: string;
  electionDate: string;
  pointId: string;
  sortOrder: number;
  equipmentName: string;
  normalizedEquipmentName: string;
  equipmentType: string;
  place: string;
  cameraStaffName: string;
}

export interface ElectionScheduleOverlay {
  eventId: string;
  electionDate: string;
  pointId: string;
  sortOrder: number;
  place: string;
  cameraStaffName: string;
  cameraStaffUserId: string | null;
  cameraStaffProfileName: string;
}
