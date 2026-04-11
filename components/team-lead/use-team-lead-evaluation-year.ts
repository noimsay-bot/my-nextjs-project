"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { getTeamLeadEvaluationYear, parseTeamLeadEvaluationYear } from "@/lib/team-lead/evaluation-year";

export function useTeamLeadEvaluationYear() {
  const searchParams = useSearchParams();

  return useMemo(() => {
    return parseTeamLeadEvaluationYear(searchParams.get("year")) ?? getTeamLeadEvaluationYear();
  }, [searchParams]);
}
