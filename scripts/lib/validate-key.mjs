export const MODELS_ENDPOINT = "https://api.typesafe.ai/v1/models";

export async function validateApiKey(key, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(MODELS_ENDPOINT, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch {
    return { ok: false, reason: "request-failed" };
  }
  if (response.status === 401) return { ok: false, reason: "unauthorized" };
  if (!response.ok) return { ok: false, reason: "request-failed" };
  try {
    const body = await response.json();
    if (!body || !Array.isArray(body.models)) return { ok: false, reason: "unexpected-response" };
  } catch {
    return { ok: false, reason: "unexpected-response" };
  }
  return { ok: true };
}
