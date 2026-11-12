import { selectors } from "./selectors.mjs";

export function classifyLocation(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: "pending", reason: "invalid-url" };
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  const signup = selectors.login.failure.signupPath;
  const landing = selectors.login.failure.landingPath;

  if (host === "mycl.io" || host.endsWith(".mycl.io")) {
    if (path === signup || path.startsWith(`${signup}/`)) {
      return { kind: "failed", reason: "signup" };
    }
    if (path === landing || path.startsWith(`${landing}/`)) {
      return { kind: "failed", reason: "pricing" };
    }
    return { kind: "authenticated", reason: "mycl" };
  }

  if (host === "www.teacherville.co.kr" || host === "teacherville.co.kr") {
    return { kind: "pending", reason: "teacherville" };
  }

  return { kind: "pending", reason: "other" };
}

export async function waitForManualLogin(page, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const intervalMs = options.intervalMs ?? 200;
  const log = options.log ?? console.error;
  const started = Date.now();
  let warned = false;

  while (Date.now() - started <= timeoutMs) {
    if (page.isClosed()) {
      return { ok: false, kind: "closed", reason: "closed", url: "" };
    }
    const url = page.url();
    const status = classifyLocation(url);
    if (status.kind === "authenticated") {
      return { ok: true, kind: status.kind, reason: status.reason, url };
    }
    if (status.kind === "failed" && !warned) {
      warned = true;
      log(
        "저장된 세션으로 로그인하지 못했습니다. 가입·결제·구독 화면은 진행하지 않습니다. 이 창에서 직접 로그인하세요.",
      );
    }
    await page.waitForTimeout(intervalMs);
  }

  const url = page.isClosed() ? "" : page.url();
  const status = url ? classifyLocation(url) : { kind: "timeout", reason: "timeout" };
  return { ok: false, kind: "timeout", reason: status.reason, url };
}
