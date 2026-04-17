import * as Sentry from "@sentry/nextjs";

const tracesSampleRate = process.env.NODE_ENV === "development" ? 1.0 : 0.05;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate,
});
