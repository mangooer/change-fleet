import { readFile } from "node:fs/promises";

const ROOT = new URL("./", import.meta.url);
const ASSETS = Object.freeze(
  new Map([
    ["app.css", "app.css"],
    ["app.js", "app.js"],
  ]),
);

// UI 资产由仓库原生持有；服务端只按白名单读取静态文件，不依赖外部资源、模板引擎或构建产物。
export async function readConsoleAsset(name) {
  const fileName = ASSETS.get(name);
  if (!fileName) return null;
  return readFile(new URL(fileName, ROOT), "utf8");
}

export function renderIndexHtml({
  sessionNonce,
  csrfNonce,
  selectedChangeSetId,
}) {
  const bootstrap = safeJson({
    session_nonce: sessionNonce,
    csrf_nonce: csrfNonce,
    selected_change_set_id: selectedChangeSetId ?? null,
  });
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ChangeFleet 任务控制台</title>
    <link rel="stylesheet" href="/app.css">
  </head>
  <body>
    <main class="shell">
      <header class="hero compact-hero">
        <div>
          <p class="eyebrow">Local agent control plane</p>
          <h1>ChangeFleet</h1>
        </div>
        <div id="status" class="status">正在初始化本地会话。</div>
      </header>
      <section class="layout">
        <aside class="panel sidebar" aria-label="任务列表">
          <div class="panel-header">
            <h2>任务</h2>
            <div class="actions">
              <button id="new-changeset" type="button">新建</button>
              <button id="load-more" class="ghost" type="button">更多</button>
            </div>
          </div>
          <div id="changeset-list" class="changeset-list"></div>
        </aside>
        <section id="changeset-detail" class="panel detail" aria-live="polite"></section>
      </section>
    </main>
    <dialog id="create-task-dialog" class="modal"><div id="create-task-content"></div></dialog>
    <dialog id="audit-dialog" class="modal"><div id="audit-content"></div></dialog>
    <script id="changefleet-bootstrap" type="application/json">${bootstrap}</script>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
