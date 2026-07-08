import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  EMAIL_FROM: z.string().min(1),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  // z.coerce.boolean()은 "false" 문자열도 true로 바꾸므로 문자열을 엄격하게 파싱한다.
  // 기본값 false: 명시적으로 켜지 않는 한 실제 메일을 발송한다.
  MAIL_LOG_ONLY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>) {
  return envSchema.parse(config);
}
