import { expect, test } from "@playwright/test";
import { buildCorporateCardMemo, omitParenthesizedPeople } from "@/lib/corporate-card/memo";

test("corporate card memo omits parenthesized people from schedule content", () => {
  expect(
    buildCorporateCardMemo({
      date: "2026-05-02",
      scheduleContent: "2026 월드컵 멕시코 현지 답사 및 사전취재(전영희)",
      userName: "박재현",
      audioManName: "오디오맨",
      seniorName: "형님",
    }),
  ).toBe("0502 2026 월드컵 멕시코 현지 답사 및 사전취재 일정식대 박재현 오디오맨 형님");
});

test("parenthesized people cleanup supports placeholders and multiple names", () => {
  expect(omitParenthesizedPeople("국회 일정(000)")).toBe("국회 일정");
  expect(omitParenthesizedPeople("현장 취재 (전영희/홍길동) 후속")).toBe("현장 취재 후속");
});

test("parenthesized people cleanup preserves non-person details", () => {
  expect(omitParenthesizedPeople("월드컵(2026) 사전취재 (1안)")).toBe("월드컵(2026) 사전취재 (1안)");
  expect(omitParenthesizedPeople("월드컵(멕시코) 현지답사")).toBe("월드컵(멕시코) 현지답사");
});
