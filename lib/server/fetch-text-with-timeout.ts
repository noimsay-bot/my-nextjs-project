import "server-only";

/** Keep the deadline active until the response body has finished, not just its headers. */
export async function fetchTextWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 8_000,
) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abortFromCaller();
  else init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
}
