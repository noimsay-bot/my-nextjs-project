import { VacationType } from "@/lib/schedule/types";

export interface VacationStyleTone {
  background: string;
  border: string;
  borderColor: string;
  color: string;
}

export const deskEditableVacationTypes: VacationType[] = ["연차", "대휴", "기타"];

export const vacationLegendOrder: VacationType[] = ["연차", "대휴", "기타"];

export const vacationTypeLabels: Record<VacationType, string> = {
  연차: "연차",
  대휴: "대휴",
  기타: "기타",
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
  기타: {
    background: "rgba(139,92,246,.2)",
    border: "1px solid rgba(167,139,250,.4)",
    borderColor: "rgba(167,139,250,.4)",
    color: "#ddd6fe",
  },
};
