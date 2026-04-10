import { VacationType } from "@/lib/schedule/types";

export interface VacationStyleTone {
  background: string;
  border: string;
  borderColor: string;
  color: string;
}

export const deskEditableVacationTypes: VacationType[] = ["연차", "대휴", "공가", "경조"];

export const vacationLegendOrder: VacationType[] = ["연차", "대휴", "공가", "근속휴가", "건강검진", "경조"];

export const vacationTypeLabels: Record<VacationType, string> = {
  연차: "연차",
  대휴: "대휴",
  공가: "공가",
  근속휴가: "근속",
  건강검진: "검진",
  경조: "경조",
};

export const vacationStyleTones: Record<VacationType, VacationStyleTone> = {
  연차: {
    background: "rgba(59,130,246,.22)",
    border: "1px solid rgba(96,165,250,.5)",
    borderColor: "rgba(96,165,250,.5)",
    color: "#dbeafe",
  },
  대휴: {
    background: "rgba(16,185,129,.22)",
    border: "1px solid rgba(52,211,153,.5)",
    borderColor: "rgba(52,211,153,.5)",
    color: "#d1fae5",
  },
  공가: {
    background: "rgba(245, 158, 11, 0.22)",
    border: "1px solid #D97706",
    borderColor: "#D97706",
    color: "#FFFFFF",
  },
  근속휴가: {
    background: "rgba(245,158,11,.2)",
    border: "1px solid rgba(251,191,36,.4)",
    borderColor: "rgba(251,191,36,.4)",
    color: "#fde68a",
  },
  건강검진: {
    background: "rgba(139,92,246,.2)",
    border: "1px solid rgba(167,139,250,.4)",
    borderColor: "rgba(167,139,250,.4)",
    color: "#ddd6fe",
  },
  경조: {
    background: "rgba(239,68,68,.2)",
    border: "1px solid rgba(248,113,113,.4)",
    borderColor: "rgba(248,113,113,.4)",
    color: "#fecaca",
  },
};
