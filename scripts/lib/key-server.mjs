import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { last4, saveApiKey } from "./secrets.mjs";
import { validateApiKey } from "./validate-key.mjs";

export const KEY_SERVER_TIMEOUT_MS = 3 * 60 * 1000;
export const CONSOLE_KEYS_URL = "https://console.typesafe.ai/keys";

function sameToken(left, right) {
  const given = Buffer.from(String(left ?? ""));
  const expected = Buffer.from(right);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

function pageHtml() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>Jev 키</title>
  <style>
    body { font: 16px/1.5 sans-serif; margin: 2rem auto; max-width: 28rem; }
    label, button, a { display: inline-block; }
    input { width: 100%; box-sizing: border-box; font: inherit; margin: 0.5rem 0 1rem; }
    button { margin-right: 0.5rem; }
    dialog { max-width: 24rem; }
  </style>
</head>
<body>
  <h1>Jev 키 입력</h1>
  <p>키는 이 브라우저 안에서만 받고, 채팅에는 붙이지 않습니다.</p>
  <form id="form">
    <label for="key">API 키</label>
    <input id="key" type="password" autocomplete="off" />
    <button type="button" id="paste">붙여넣기</button>
    <button type="button" id="help-open">발급 안내</button>
    <button type="submit">저장</button>
  </form>
  <p id="status" role="status"></p>
  <dialog id="help">
    <p>TypeSafe 콘솔에서 키를 만든 뒤, 이 창의 가림 칸에 붙여 넣습니다.</p>
    <p><a href="${CONSOLE_KEYS_URL}" target="_blank" rel="noopener noreferrer">TypeSafe 콘솔에서 키 발급</a></p>
    <button type="button" id="help-close">닫기</button>
  </dialog>
  <script>
    const status = document.getElementById("status");
    document.getElementById("help-open").onclick = () => document.getElementById("help").showModal();
    document.getElementById("help-close").onclick = () => document.getElementById("help").close();
    document.getElementById("paste").onclick = async () => {
      try {
        document.getElementById("key").value = await navigator.clipboard.readText();
      } catch {
        status.textContent = "붙여넣기를 허용하지 않으면 칸에 직접 붙여 넣으세요.";
      }
    };
    document.getElementById("form").onsubmit = async (event) => {
      event.preventDefault();
      const token = new URLSearchParams(location.search).get("token");
      const key = document.getElementById("key").value;
      const response = await fetch("/save?token=" + encodeURIComponent(token || ""), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        status.textContent = "저장했습니다. 끝 네 자리는 " + (body.last4 || "••••") + " 입니다. 이 창을 닫아도 됩니다.";
        document.getElementById("key").value = "";
        return;
      }
      status.textContent = body.message || "저장하지 못했습니다.";
    };
  </script>
</body>
</html>`;
}

function send(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

export function createKeyServer(options = {}) {
  const token = options.token ?? randomBytes(32).toString("base64url");
  const logs = [];
  const log = (message) => {
    logs.push(message);
    options.log?.(message);
  };
  let submitted = false;
  let busy = false;
  let settle = () => {};
  const done = new Promise((resolve) => {
    settle = resolve;
  });
  let settled = false;
  function finish(result) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    settle(result);
  }

  const server = createServer(async (request, response) => {
    const host = String(request.headers.host ?? "").split(":")[0];
    if (host !== "127.0.0.1") {
      log("rejected-host");
      send(response, 403, { message: "이 페이지는 이 컴퓨터에서만 열립니다." });
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const given = url.searchParams.get("token");
    if (!sameToken(given, token)) {
      log("rejected-token");
      send(response, 403, { message: "이 주소는 쓸 수 없습니다." });
      return;
    }
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(pageHtml());
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/save") {
      send(response, 404, { message: "없는 주소입니다." });
      return;
    }
    const origin = request.headers.origin;
    const port = server.address()?.port;
    if (origin !== `http://127.0.0.1:${port}`) {
      log("rejected-origin");
      send(response, 403, { message: "이 페이지에서만 저장할 수 있습니다." });
      return;
    }
    if (submitted || busy) {
      log("rejected-duplicate");
      send(response, 409, { message: "이미 한 번 저장했습니다." });
      return;
    }
    busy = true;
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 8192) {
        busy = false;
        send(response, 413, { message: "입력이 너무 깁니다." });
        return;
      }
      chunks.push(chunk);
    }
    let key = "";
    try {
      key = String(JSON.parse(Buffer.concat(chunks).toString("utf8")).key ?? "").trim();
    } catch {
      busy = false;
      send(response, 400, { message: "키를 읽지 못했습니다." });
      return;
    }
    if (!key) {
      busy = false;
      send(response, 400, { message: "키가 비어 있습니다." });
      return;
    }
    const validation = await validateApiKey(key, options.fetchImpl ?? fetch);
    if (!validation.ok) {
      busy = false;
      log(`rejected-validation:${validation.reason}`);
      send(response, 400, { message: "키를 확인하지 못했습니다. 콘솔에서 발급한 키인지 다시 확인해 주세요." });
      return;
    }
    submitted = true;
    const saved = await saveApiKey(key, options);
    const tail = last4(key);
    log("saved");
    send(response, 200, { ok: true, last4: tail, source: saved.source });
    finish({ ok: true, last4: tail, source: saved.source });
    server.close();
  });

  const timer = setTimeout(() => {
    log("timeout");
    finish({ ok: false, reason: "timeout" });
    server.close();
  }, options.timeoutMs ?? KEY_SERVER_TIMEOUT_MS);
  timer.unref?.();

  return {
    token,
    logs,
    done,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          resolve(address);
        });
      });
    },
    url() {
      const address = server.address();
      return `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(token)}`;
    },
    close() {
      finish({ ok: false, reason: "closed" });
      server.close();
    },
  };
}

export async function runKeySetup(options) {
  const openBrowser = options.openBrowser;
  if (!openBrowser) throw new Error("브라우저 열기 함수가 필요합니다.");
  const session = createKeyServer(options);
  const address = await session.listen();
  if (address.address !== "127.0.0.1") {
    session.close();
    throw new Error("키 입력 서버는 127.0.0.1에서만 엽니다.");
  }
  const opened = await openBrowser(session.url());
  if (!opened) {
    session.close();
    const key = await options.readHidden("Jev API 키를 입력하세요. 입력은 화면에 표시되지 않습니다.\n");
    const trimmed = String(key ?? "").trim();
    if (!trimmed) return { ok: false, reason: "empty" };
    const validation = await validateApiKey(trimmed, options.fetchImpl ?? fetch);
    if (!validation.ok) return { ok: false, reason: validation.reason };
    const saved = await saveApiKey(trimmed, options);
    return { ok: true, last4: last4(trimmed), source: saved.source };
  }
  return session.done;
}
