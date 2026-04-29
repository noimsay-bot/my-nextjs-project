"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getRecentTeamLeadEvaluationYears,
  getTeamLeadEvaluationYear,
  parseTeamLeadEvaluationYear,
} from "@/lib/team-lead/evaluation-year";

const items = [
  { href: "/team-lead/special-report", label: "영상평가 결과" },
  { href: "/team-lead/contribution", label: "팀 기여도" },
  { href: "/team-lead/broadcast-accident", label: "장비/인적 사고" },
  { href: "/team-lead/live-safety", label: "라이브 무사고" },
  { href: "/team-lead/overall-score", label: "개인별 점수" },
  { href: "/team-lead/overall-score-summary", label: "종합점수" },
  { href: "/team-lead/reference-notes", label: "참고사항" },
];

const utilityItems = [
  { href: "/team-lead/reviewer-management", label: "영상평가 관리" },
];

export function TeamLeadShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentEvaluationYear = parseTeamLeadEvaluationYear(searchParams.get("year")) ?? getTeamLeadEvaluationYear();
  const yearOptions = useMemo(
    () => getRecentTeamLeadEvaluationYears(currentEvaluationYear),
    [currentEvaluationYear],
  );
  const queryString = searchParams.toString();
  const buildHref = (href: string) => (queryString ? `${href}?${queryString}` : href);

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">총괄팀장</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {items.map((item) => (
              <Link
                key={item.href}
                href={buildHref(item.href)}
                className={`btn ${pathname === item.href ? "white" : ""} ${
                  item.href === "/team-lead/overall-score"
                    ? "btn-team-lead-personal"
                    : item.href === "/team-lead/overall-score-summary"
                      ? "btn-team-lead-summary"
                      : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {utilityItems.map((item) => (
              <Link key={item.href} href={buildHref(item.href)} className={`btn ${pathname === item.href ? "white" : ""}`}>
                {item.label}
              </Link>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 13 }}>평가연도</span>
            <select
              className="field-input"
              value={String(currentEvaluationYear)}
              onChange={(event) => {
                const nextParams = new URLSearchParams(searchParams.toString());
                nextParams.set("year", event.target.value);
                const nextQuery = nextParams.toString();
                router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
              }}
              style={{ width: 140 }}
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}년
                </option>
              ))}
            </select>
            <span className="muted" style={{ fontSize: 13 }}>
              {currentEvaluationYear - 1}년 12월 ~ {currentEvaluationYear}년 11월
            </span>
          </div>
        </div>
      </article>
      {children}
    </section>
  );
}
