import { expect, test } from "@playwright/test";
import { buildTeamLeadReferenceNotesPrintPages } from "@/lib/team-lead/print";

test("reference notes print pages include visible notes and escape user text", () => {
  const pages = buildTeamLeadReferenceNotesPrintPages(
    2026,
    [
      {
        name: "김영묵",
        roleLabel: "팀원",
        items: ["첫 번째 참고사항", "<script>alert('x')</script>"],
      },
      {
        name: "홍길동",
        roleLabel: "평가자",
        items: [],
      },
    ],
    { hasUnsavedDrafts: true },
  );

  expect(pages).toHaveLength(1);
  expect(pages[0].title).toBe("참고사항");
  expect(pages[0].bodyHtml).toContain("2025년 12월 ~ 2026년 11월 기준");
  expect(pages[0].bodyHtml).toContain("미저장 초안 포함");
  expect(pages[0].bodyHtml).toContain("김영묵");
  expect(pages[0].bodyHtml).toContain("첫 번째 참고사항");
  expect(pages[0].bodyHtml).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
  expect(pages[0].bodyHtml).not.toContain("<script>");
  expect(pages[0].bodyHtml).toContain("추가된 항목이 없습니다.");
});

test("reference notes print pages split long notes instead of clipping one card", () => {
  const pages = buildTeamLeadReferenceNotesPrintPages(2026, [
    {
      name: "김영묵",
      roleLabel: "팀원",
      items: ["긴 참고사항 ".repeat(500)],
    },
  ]);

  expect(pages.length).toBeGreaterThan(1);
  expect(pages[0].title).toContain("1/");
  expect(pages.slice(1).some((page) => page.bodyHtml.includes("김영묵 (계속)"))).toBe(true);
});
