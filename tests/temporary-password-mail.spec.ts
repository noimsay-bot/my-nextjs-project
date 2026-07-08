import { expect, test } from "@playwright/test";
import {
  buildTemporaryPasswordMailText,
  deliverTemporaryPasswordMail,
  maskEmail,
  resolveSmtpSecure,
  type TemporaryPasswordMailInput,
} from "@/lib/server/mail-core";

const sampleInput: TemporaryPasswordMailInput = {
  email: "user@example.com",
  loginId: "cameraman1",
  username: "홍길동",
  temporaryPassword: "Temp1234ab",
};

test.describe("resolveSmtpSecure", () => {
  test('"true"/"false" 문자열은 그대로 사용한다', () => {
    expect(resolveSmtpSecure("true", 587)).toEqual({ secure: true, inferredFromPort: false });
    expect(resolveSmtpSecure("false", 465)).toEqual({ secure: false, inferredFromPort: false });
  });

  test("그 외 값은 포트 기준으로 추론한다(465=true)", () => {
    expect(resolveSmtpSecure(undefined, 465)).toEqual({ secure: true, inferredFromPort: true });
    expect(resolveSmtpSecure(undefined, 587)).toEqual({ secure: false, inferredFromPort: true });
    expect(resolveSmtpSecure("1", 465)).toEqual({ secure: true, inferredFromPort: true });
    expect(resolveSmtpSecure("TRUE", 25)).toEqual({ secure: false, inferredFromPort: true });
  });
});

test.describe("maskEmail", () => {
  test("로컬 파트 앞 2자만 남기고 마스킹한다", () => {
    expect(maskEmail("abcdef@example.com")).toBe("ab***@example.com");
    expect(maskEmail("a@example.com")).toBe("a***@example.com");
    expect(maskEmail("not-an-email")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
  });
});

test.describe("deliverTemporaryPasswordMail", () => {
  test("MAIL_LOG_ONLY 모드에서는 발송하지 않고 sent:false를 반환한다", async () => {
    const sent: unknown[] = [];
    const warnings: string[] = [];

    const result = await deliverTemporaryPasswordMail(
      sampleInput,
      { mailLogOnly: true, siteUrl: "https://hub.example.com", from: "no-reply@example.com" },
      {
        sendMail: async (message) => {
          sent.push(message);
        },
        warn: (message) => warnings.push(message),
      },
    );

    expect(result).toEqual({ sent: false, reason: "log_only" });
    expect(sent).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("user@example.com");
    expect(warnings[0]).toContain("Temp1234ab");
  });

  test("정상 모드에서는 메일을 발송하고 sent:true를 반환한다", async () => {
    const sent: Array<{ from: string; to: string; subject: string; text: string }> = [];

    const result = await deliverTemporaryPasswordMail(
      sampleInput,
      { mailLogOnly: false, siteUrl: "https://hub.example.com", from: "no-reply@example.com" },
      {
        sendMail: async (message) => {
          sent.push(message);
        },
        warn: () => {},
      },
    );

    expect(result).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("user@example.com");
    expect(sent[0].from).toBe("no-reply@example.com");
    expect(sent[0].text).toContain("Temp1234ab");
    expect(sent[0].text).toContain("https://hub.example.com/login");
  });

  test("EMAIL_FROM이 없으면 발송하지 않고 throw 한다", async () => {
    const sent: unknown[] = [];

    await expect(
      deliverTemporaryPasswordMail(
        sampleInput,
        { mailLogOnly: false, siteUrl: "https://hub.example.com", from: undefined },
        {
          sendMail: async (message) => {
            sent.push(message);
          },
          warn: () => {},
        },
      ),
    ).rejects.toThrow("EMAIL_FROM");
    expect(sent).toHaveLength(0);
  });

  test("SMTP 오류는 그대로 전파된다", async () => {
    await expect(
      deliverTemporaryPasswordMail(
        sampleInput,
        { mailLogOnly: false, siteUrl: "https://hub.example.com", from: "no-reply@example.com" },
        {
          sendMail: async () => {
            throw new Error("SMTP connection refused");
          },
          warn: () => {},
        },
      ),
    ).rejects.toThrow("SMTP connection refused");
  });
});

test("buildTemporaryPasswordMailText는 아이디/임시 비밀번호/로그인 URL을 포함한다", () => {
  const text = buildTemporaryPasswordMailText(sampleInput, "https://hub.example.com");
  expect(text).toContain("아이디: cameraman1");
  expect(text).toContain("임시 비밀번호: Temp1234ab");
  expect(text).toContain("https://hub.example.com/login");
});
