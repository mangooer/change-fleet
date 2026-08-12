const bootstrap = readBootstrap();

// 页面只维护面向操作者的任务投影；精确身份、幂等和状态裁决仍由服务端负责。
const state = {
  intake: null,
  list: null,
  selectedChangeSetId: bootstrap.selected_change_set_id ?? null,
  exact: null,
  audit: null,
  live: null,
  loading: false,
  pendingAction: null,
  error: null,
  createProjectId: null,
  streamController: null,
  quietRefreshing: false,
  pendingMessages: [],
};

const elements = {
  list: document.querySelector("#changeset-list"),
  detail: document.querySelector("#changeset-detail"),
  loadMore: document.querySelector("#load-more"),
  newTask: document.querySelector("#new-changeset"),
  status: document.querySelector("#status"),
  createDialog: document.querySelector("#create-task-dialog"),
  createContent: document.querySelector("#create-task-content"),
  auditDialog: document.querySelector("#audit-dialog"),
  auditContent: document.querySelector("#audit-content"),
};

const attemptStore = {
  get(key) {
    return globalThis.localStorage.getItem(`changefleet:${key}`);
  },
  set(key, value) {
    globalThis.localStorage.setItem(`changefleet:${key}`, value);
  },
  delete(key) {
    globalThis.localStorage.removeItem(`changefleet:${key}`);
  },
};

elements.loadMore.addEventListener("click", () => void loadMore());
elements.newTask.addEventListener("click", () => openCreateDialog());
void loadInitial();

async function loadInitial() {
  await withLoading(async () => {
    [state.intake, state.list] = await Promise.all([
      apiGet("/api/local/v0/intake/options"),
      apiGet("/api/local/v0/changesets?limit=20"),
    ]);
    state.createProjectId = state.intake.projects[0]?.project_id ?? null;
    if (!state.selectedChangeSetId) {
      state.selectedChangeSetId = state.list.items[0]?.change_set_id ?? null;
    }
    if (state.selectedChangeSetId) await loadExact(state.selectedChangeSetId);
  });
  if (!state.selectedChangeSetId && (state.intake?.projects.length ?? 0) > 0) {
    openCreateDialog();
  }
}

async function loadMore() {
  if (!state.list?.next_cursor) return;
  await withLoading(async () => {
    const next = await apiGet(
      `/api/local/v0/changesets?limit=20&cursor=${encodeURIComponent(state.list.next_cursor)}`,
    );
    state.list = { ...next, items: [...state.list.items, ...next.items] };
  });
}

async function loadExact(changeSetId) {
  state.selectedChangeSetId = changeSetId;
  updateLocation(changeSetId);
  const [exact, audit] = await Promise.all([
    apiGet(`/api/local/v0/changesets/${encodeURIComponent(changeSetId)}`),
    apiGet(`/api/local/v0/changesets/${encodeURIComponent(changeSetId)}/audit`),
  ]);
  state.exact = exact;
  state.audit = audit;
  state.live = null;
  clearFinishedAttempts();
  startLiveStream(changeSetId);
}

async function withLoading(work) {
  state.loading = true;
  state.error = null;
  render();
  try {
    await work();
  } catch (error) {
    state.error = error;
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  renderStatus();
  renderList();
  renderDetail();
}

function renderStatus() {
  if (state.error) {
    elements.status.textContent = state.error.message;
    elements.status.className = "status error";
    return;
  }
  const liveRun = state.live?.run?.status === "running";
  elements.status.textContent = state.pendingAction
    ? `正在${state.pendingAction}…`
    : liveRun
      ? `${stageLabel(state.live.run.operation)}正在运行`
      : "本机控制台 · 精确工作区 · 人工合并";
  elements.status.className = "status";
}

function renderList() {
  const items = state.list?.items ?? [];
  if (items.length === 0) {
    elements.list.innerHTML = '<div class="empty">还没有任务。</div>';
  } else {
    const groups = [
      ["待反馈", items.filter((item) => item.operator_status === "needs_feedback")],
      ["待审查", items.filter((item) => item.operator_status === "needs_review")],
      ["等待合入", items.filter((item) => item.operator_status === "waiting_for_merge")],
      ["进行中", items.filter((item) => item.operator_status === "running")],
      ["已完成", items.filter((item) => item.operator_status === "complete")],
      ["已取消", items.filter((item) => item.operator_status === "cancelled")],
    ];
    elements.list.innerHTML = groups
      .filter(([, group]) => group.length > 0)
      .map(
        ([label, group]) => `
          <section class="task-group">
            <h3>${label}<span>${group.length}</span></h3>
            ${group.map(renderTaskCard).join("")}
          </section>`,
      )
      .join("");
  }
  for (const card of elements.list.querySelectorAll("[data-change-set-id]")) {
    card.addEventListener("click", () =>
      void withLoading(() => loadExact(card.dataset.changeSetId)),
    );
  }
  elements.loadMore.disabled = !state.list?.next_cursor || state.loading;
  elements.newTask.disabled =
    state.loading || (state.intake?.projects.length ?? 0) === 0;
}

function renderTaskCard(item) {
  const selected = item.change_set_id === state.selectedChangeSetId;
  const status = taskStatus(item);
  return `
    <article class="changeset-card ${selected ? "active" : ""}" data-change-set-id="${escapeAttribute(item.change_set_id)}">
      <div class="row">
        <strong>${escapeHtml(item.current_intent?.objective ?? "未命名任务")}</strong>
        <span class="status-dot ${pillClass(status.kind)}"></span>
      </div>
      <p>${escapeHtml(status.label)}</p>
      <div class="card-meta">${escapeHtml(item.project_id)} · ${formatRelativeTime(item.updated_at)}</div>
    </article>`;
}

function renderDetail() {
  if (!state.exact) {
    elements.detail.innerHTML = '<div class="empty detail-empty">选择一个任务，或新建任务。</div>';
    return;
  }
  const exact = state.exact;
  const status = taskStatus(exact);
  const profile = exact.task_workspace?.agent_profile ?? state.intake?.agent_profile;
  const metrics = compactMetrics(state.audit);
  const currentPlan = exact.plan ?? exact.planning_message?.plan ?? null;
  const bundle = exact.bundle;
  const quality = bundle?.quality_review ?? null;
  const reviewMode = exact.task_workspace?.bundle_review?.mode ?? "none";
  const canAccept =
    bundle &&
    (reviewMode !== "independent" ||
      ["pass", "gate"].includes(quality?.disposition) ||
      exact.gates.some((gate) => gate.kind.startsWith("bundle_review")));
  elements.detail.innerHTML = `
    <header class="task-header">
      <div>
        <p class="eyebrow">${escapeHtml(exact.project_id)}</p>
        <h2>${escapeHtml(exact.current_intent?.objective ?? exact.change_set_id)}</h2>
        <div class="task-subline">
          <span class="pill ${pillClass(status.kind)}">${escapeHtml(status.label)}</span>
          <span>${escapeHtml(runtimeLabel(profile))}</span>
          <span>${formatNumber(metrics.tokens)} tokens</span>
          <span>${formatDuration(metrics.duration_ms)}</span>
          <span>${metrics.runs} 次运行</span>
          <span>${metrics.failures} 次失败/中断</span>
          <span>${metrics.rework} 次返工</span>
        </div>
      </div>
      <div class="actions">
        ${renderTaskControl(exact)}
        <button id="open-audit" class="ghost" type="button">审计</button>
      </div>
    </header>

    <section id="live-panel" class="live-panel">${renderLivePanel()}</section>

    <section class="workspace-grid">
      <article class="surface conversation-surface">
        <div class="section-title">
          <div><p class="eyebrow">Conversation</p><h3>任务对话</h3></div>
          <span class="muted">当前阶段：${escapeHtml(stageLabel(exact.phase))}</span>
        </div>
        <div class="conversation">${renderConversation(exact.conversation, state.pendingMessages)}</div>
        ${renderComposer(exact)}
      </article>

      <aside class="task-rail">
        <article class="surface plan-surface">
          <div class="section-title">
            <div><p class="eyebrow">Plan</p><h3>${currentPlan ? escapeHtml(currentPlan.summary) : "等待计划"}</h3></div>
            ${exact.current_revisions.plan_revision ? `<span class="pill">r${escapeHtml(exact.current_revisions.plan_revision)}</span>` : ""}
          </div>
          ${renderPlan(currentPlan, exact)}
        </article>
        ${renderGatePanel(exact.gates)}
        ${renderBundlePanel(exact, bundle, quality, canAccept)}
        ${renderDeliveryPanel(exact, bundle)}
      </aside>
    </section>
  `;
  bindDetailActions();
}

function renderTaskControl(exact) {
  if (exact.phase === "terminal") return "";
  const controls = [];
  if (state.live?.run?.status === "running") {
    controls.push('<button id="pause-task" class="secondary" type="button">暂停当前运行</button>');
  }
  if (
    state.live?.run?.status !== "running" &&
    exact.operator_status === "needs_feedback" &&
    exact.phase === "running"
  ) {
    controls.push('<button id="resume-task" class="secondary" type="button">继续</button>');
  }
  controls.push('<button id="cancel-task" class="danger" type="button">取消任务</button>');
  return controls.join("");
}

function renderLivePanel() {
  const live = state.live;
  if (!live?.run || live.run.status !== "running") {
    return '<div class="live-idle"><span class="status-dot"></span>当前没有运行中的 Agent</div>';
  }
  const items = live.progress?.items ?? [];
  const latest = live.recent_activity?.at(-1);
  return `
    <div class="row">
      <div><span class="live-pulse"></span><strong>${escapeHtml(stageLabel(live.run.operation))}运行中</strong> · 第 ${escapeHtml(live.run.attempt ?? 1)} 次尝试</div>
      <span class="muted">${escapeHtml(activityLabel(latest))}</span>
    </div>
    ${
      items.length === 0
        ? ""
        : `<ol class="live-todos">${items
            .map(
              (item) =>
                `<li class="${item.completed ? "done" : ""}"><span>${item.completed ? "✓" : "·"}</span>${escapeHtml(item.text)}</li>`,
            )
            .join("")}</ol>`
    }`;
}

function renderConversation(conversation, pendingMessages = []) {
  const messages = [...(conversation?.messages ?? []), ...pendingMessages];
  if (messages.length === 0) {
    return '<div class="empty">Planner 正在读取任务与仓库上下文。</div>';
  }
  return messages
    .map(
      (message) => `
        <article class="message ${message.role === "human" ? "human-message" : "agent-message"} ${message.pending ? "pending-message" : ""}">
          <div class="message-meta"><strong>${message.role === "human" ? "你" : message.role === "system" ? "ChangeFleet" : stageAgentLabel(message.stage)}</strong><span>${formatRelativeTime(message.created_at)}</span></div>
          <p>${escapeHtml(message.text)}</p>${message.pending ? '<span class="muted">正在发送…</span>' : ""}
        </article>`,
    )
    .join("");
}

function renderComposer(exact) {
  if (exact.phase === "terminal") return "";
  const placeholder =
    exact.phase === "planning"
      ? "补充目标或回答 Planner 的问题…"
      : exact.phase === "review"
        ? "指出需要修改的地方；发送后会在同一计划下修正…"
        : "补充信息或反馈当前实现…";
  return `
    <form id="task-message-form" class="composer">
      <textarea id="task-message-input" rows="3" placeholder="${placeholder}" required></textarea>
      <div class="composer-actions"><span class="muted">反馈是输入，不会被当作事实盲目执行。</span><button type="submit">发送</button></div>
    </form>`;
}

function renderPlan(plan, exact) {
  if (!plan) {
    return `<div class="empty">对话完成后，Planner 会在这里给出可确认的语义计划。</div>${
      exact.phase === "planning" && state.live?.run?.status !== "running"
        ? '<button id="retry-planning" class="secondary" type="button">重试规划</button>'
        : ""
    }`;
  }
  const completed = ["review", "terminal"].includes(exact.phase);
  return `
    <ol class="plan-steps">${plan.steps
      .map(
        (step, index) =>
          `<li class="${completed ? "done" : ""}"><span>${completed ? "✓" : index + 1}</span><p>${escapeHtml(step)}</p></li>`,
      )
      .join("")}</ol>
    ${
      plan.validation.length === 0
        ? ""
        : `<details><summary>验证方式</summary><ul>${plan.validation.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>`
    }`;
}

function renderGatePanel(gates) {
  if (gates.length === 0) return "";
  return `
    <article class="surface gate-surface">
      <p class="eyebrow">Needs input</p>
      ${gates
        .map(
          (gate) => `
            <div class="gate">
              <h3>${escapeHtml(gate.question ?? gate.kind)}</h3>
              <div class="actions">${gate.options
                .map(
                  (option) =>
                    `<button class="secondary resolve-gate" type="button" data-gate-id="${escapeAttribute(gate.gate_id)}" data-option="${escapeAttribute(option)}">${escapeHtml(option)}</button>`,
                )
                .join("")}</div>
            </div>`,
        )
        .join("")}
    </article>`;
}

function renderBundlePanel(exact, bundle, quality, canAccept) {
  if (!bundle) return "";
  return `
    <article class="surface review-surface">
      <div class="section-title"><div><p class="eyebrow">Review</p><h3>候选变更</h3></div><span class="pill">${bundle.candidates.length} 个仓库</span></div>
      <p>${escapeHtml(quality?.summary ?? "确定性验证已完成，等待最终审查。")}</p>
      ${
        quality?.findings?.length
          ? `<ul>${quality.findings.map((finding) => `<li>${escapeHtml(finding.summary ?? finding.text ?? finding.code)}</li>`).join("")}</ul>`
          : ""
      }
      <div class="candidate-summary">${bundle.candidates
        .map(
          (candidate) =>
            `<div><strong>${escapeHtml(candidate.repository_id)}</strong><span>${candidate.changed_paths.length} 个文件</span></div>`,
        )
        .join("")}</div>
      ${
        bundle.human_decision
          ? `<span class="pill">${escapeHtml(bundle.human_decision.decision)}</span>`
          : `<div class="actions"><button id="accept-bundle" type="button" ${canAccept ? "" : "disabled"}>接受候选</button><button id="reject-bundle" class="danger" type="button">放弃任务</button></div>`
      }
      <p class="muted">需要修改时直接在左侧对话中反馈。</p>
    </article>`;
}

function renderDeliveryPanel(exact, bundle) {
  if (!bundle || bundle.human_decision?.decision !== "accept") return "";
  const delivery = exact.delivery;
  const missingBindings = exact.repositories.filter(
    (repository) => repository.delivery_binding.status === "missing",
  );
  const publishing =
    exact.task_control?.current_command?.kind === "publish" &&
    ["accepted", "running"].includes(exact.task_control.current_command.status);
  return `
    <article class="surface delivery-surface">
      <div class="section-title"><div><p class="eyebrow">Delivery</p><h3>GitHub 交付</h3></div><span class="pill ${pillClass(delivery.activity)}">${escapeHtml(deliveryLabel(delivery.activity))}</span></div>
      ${
        missingBindings.length === 0
          ? ""
          : `<form id="delivery-binding-form" class="modal-form compact-form">
              <p>先确认缺失的 GitHub 交付绑定，再重试创建 PR。</p>
              <label class="field"><span>仓库</span><select id="delivery-binding-repository">${missingBindings.map((repository) => `<option value="${escapeAttribute(repository.repository_id)}">${escapeHtml(repository.repository_id)}</option>`).join("")}</select></label>
              <label class="field"><span>GitHub 仓库</span><input id="delivery-binding-github" required placeholder="owner/repository"></label>
              <label class="field"><span>Git remote</span><input id="delivery-binding-remote" required value="origin"></label>
              <button type="submit">确认绑定</button>
            </form>`
      }
      ${delivery.deliveries
        .map(
          (item) =>
            `<div class="delivery-row"><strong>${escapeHtml(item.repository_id)}</strong><span>${escapeHtml(item.state)}</span>${item.pull_request ? `<a href="${escapeAttribute(item.pull_request.url)}" target="_blank" rel="noreferrer">PR #${escapeHtml(item.pull_request.number)}</a>` : ""}</div>`,
        )
        .join("")}
      <div class="actions">
        ${delivery.delivery_count === 0 ? publishing ? '<button type="button" disabled>正在创建 Ready PR…</button>' : '<button id="publish-delivery" type="button">重试创建 Ready PR</button>' : '<button id="refresh-delivery" class="secondary" type="button">刷新合并状态</button>'}
      </div>
    </article>`;
}

function bindDetailActions() {
  document.querySelector("#open-audit")?.addEventListener("click", () =>
    void openAuditDialog(),
  );
  document.querySelector("#task-message-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendTaskMessage();
  });
  document.querySelector("#retry-planning")?.addEventListener("click", () =>
    void retryPlanning(),
  );
  document.querySelector("#resume-task")?.addEventListener("click", () =>
    void runTaskController(),
  );
  document.querySelector("#pause-task")?.addEventListener("click", () =>
    void pauseCurrentRun(),
  );
  document.querySelector("#cancel-task")?.addEventListener("click", () =>
    void cancelTask(),
  );
  document.querySelector("#accept-bundle")?.addEventListener("click", () =>
    void decideBundle("accept"),
  );
  document.querySelector("#reject-bundle")?.addEventListener("click", () =>
    void cancelTask(),
  );
  document.querySelector("#publish-delivery")?.addEventListener("click", () =>
    void publishDelivery(),
  );
  document.querySelector("#refresh-delivery")?.addEventListener("click", () =>
    void refreshDelivery(),
  );
  document.querySelector("#delivery-binding-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void configureDeliveryBinding();
  });
  for (const button of document.querySelectorAll(".resolve-gate")) {
    button.addEventListener("click", () =>
      void resolveGate(button.dataset.gateId, button.dataset.option),
    );
  }
}

function openCreateDialog() {
  renderCreateDialog();
  elements.createDialog.showModal();
}

function renderCreateDialog() {
  const projects = state.intake?.projects ?? [];
  const project =
    projects.find((item) => item.project_id === state.createProjectId) ??
    projects[0] ??
    null;
  if (!project) {
    elements.createContent.innerHTML = '<div class="empty">请先注册 Project。</div>';
    return;
  }
  state.createProjectId = project.project_id;
  const profile = state.intake.agent_profile;
  elements.createContent.innerHTML = `
    <form id="create-task-form" class="modal-form">
      <div class="section-title"><div><p class="eyebrow">New task</p><h2>创建任务</h2></div><button id="close-create" class="icon-button" type="button" aria-label="关闭">×</button></div>
      <label class="field"><span>你希望 Agent 完成什么？</span><textarea id="create-objective" rows="5" required autofocus placeholder="用一句话描述目标；Planner 会读取项目 Harness 并在需要时提问。"></textarea></label>
      <label class="field"><span>项目</span><select id="create-project">${projects
        .map(
          (item) =>
            `<option value="${escapeAttribute(item.project_id)}" ${item.project_id === project.project_id ? "selected" : ""}>${escapeHtml(item.project_id)}${item.description ? ` · ${escapeHtml(item.description)}` : ""}</option>`,
        )
        .join("")}</select></label>
      <div class="configuration-summary"><span>默认执行 Runtime</span><strong>${escapeHtml(runtimeLabel(profile))}</strong><span>Review</span><strong>${escapeHtml(project.task_policy.bundle_review.default_mode)}</strong></div>
      <details class="advanced-config"><summary>高级配置 · 仓库与基线</summary>
        <p class="muted">Project 定义可用仓库；每个任务可以选择参与仓库和各自基线。留空时使用当前分支。</p>
        ${project.repositories
          .map(
            (repository) => `
              <article class="repository-choice">
                <label class="repository-toggle"><input type="checkbox" data-repository-selected="${escapeAttribute(repository.repository_id)}" checked><strong>${escapeHtml(repository.repository_id)}</strong><span>${escapeHtml(repository.description ?? repository.default_target_ref)}</span></label>
                <div class="two-columns"><label class="field"><span>基线分支</span><input data-branch-ref="${escapeAttribute(repository.repository_id)}" placeholder="当前分支"></label><label class="field"><span>目标分支</span><input data-target-ref="${escapeAttribute(repository.repository_id)}" placeholder="项目默认值"></label></div>
              </article>`,
          )
          .join("")}
      </details>
      <div class="modal-actions"><button id="cancel-create" class="ghost" type="button">取消</button><button type="submit">创建并开始规划</button></div>
    </form>`;
  document.querySelector("#close-create")?.addEventListener("click", () =>
    elements.createDialog.close(),
  );
  document.querySelector("#cancel-create")?.addEventListener("click", () =>
    elements.createDialog.close(),
  );
  document.querySelector("#create-project")?.addEventListener("change", (event) => {
    state.createProjectId = event.target.value;
    renderCreateDialog();
  });
  document.querySelector("#create-task-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void createTask(project);
  });
}

async function createTask(project) {
  const objective = document.querySelector("#create-objective")?.value.trim();
  const selectedIds = [...document.querySelectorAll("[data-repository-selected]:checked")].map(
    (element) => element.dataset.repositorySelected,
  );
  if (!objective || selectedIds.length === 0) return;
  const draft = {
    project_id: project.project_id,
    intent: {
      objective,
      rationale: null,
      constraints: [],
      non_goals: [],
      acceptance_criteria: [],
      resolved_decisions: [],
      open_questions: [],
    },
    planning_repository_ids: selectedIds,
    repository_selections: selectedIds.map((repositoryId) => ({
      repository_id: repositoryId,
      branch_ref: nullableValue(`[data-branch-ref="${cssAttribute(repositoryId)}"]`),
      target_ref: nullableValue(`[data-target-ref="${cssAttribute(repositoryId)}"]`),
    })),
  };
  const pending = ensurePendingCreate(draft);
  elements.createDialog.close();
  await withLoading(async () => {
    await apiPost("/api/local/v0/changesets", {
      idempotency_key: pending.idempotency_key,
      change_set_id: pending.change_set_id,
      ...draft,
    });
    state.selectedChangeSetId = pending.change_set_id;
    state.list = await apiGet("/api/local/v0/changesets?limit=20");
    clearPendingCreate();
    await loadExact(pending.change_set_id);
  });
}

async function retryPlanning() {
  if (!state.exact || state.exact.phase !== "planning") return;
  const attemptKey = `retry-planning:${state.exact.change_set_id}:${state.exact.updated_at}`;
  await runMutation("重新规划", async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/messages`,
      {
        idempotency_key: ensureAttempt(attemptKey),
        message: "请根据当前任务上下文继续规划。",
        actor: "human",
      },
    );
    attemptStore.delete(attemptKey);
  });
}

async function sendTaskMessage() {
  const input = document.querySelector("#task-message-input");
  const message = input?.value.trim();
  if (!state.exact || !message) return;
  const attemptKey = `message:${state.exact.change_set_id}:${message}`;
  const idempotencyKey = ensureAttempt(attemptKey);
  input.value = "";
  const pendingMessage = {
    message_id: `pending:${idempotencyKey}`,
    role: "human",
    stage: state.exact.phase,
    text: message,
    created_at: new Date().toISOString(),
    pending: true,
  };
  state.pendingMessages.push(pendingMessage);
  renderDetail();
  await runMutation("发送反馈", async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/messages`,
      { idempotency_key: idempotencyKey, message, actor: "human" },
    );
    attemptStore.delete(attemptKey);
  });
  state.pendingMessages = state.pendingMessages.filter(
    (candidate) => candidate.message_id !== pendingMessage.message_id,
  );
  renderDetail();
}

async function runTaskController() {
  if (!state.exact) return;
  const attemptKey = `controller:${state.exact.change_set_id}:${state.exact.updated_at}`;
  await runMutation("继续任务", async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/controller/run`,
      { idempotency_key: ensureAttempt(attemptKey), actor: "human" },
    );
    attemptStore.delete(attemptKey);
  });
}

async function pauseCurrentRun() {
  const runId = state.live?.run?.run_id;
  if (!state.exact || !runId) return;
  const attemptKey = `interrupt:${state.exact.change_set_id}:${runId}`;
  await runMutation("暂停当前运行", async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/runs/${encodeURIComponent(runId)}/interrupt`,
      { idempotency_key: ensureAttempt(attemptKey), actor: "human" },
    );
    attemptStore.delete(attemptKey);
  });
}

async function cancelTask() {
  if (!state.exact || !globalThis.confirm("确定取消这个任务吗？任务将停止自动运行，并释放未交付的工作区资源。")) return;
  const attemptKey = `cancel:${state.exact.change_set_id}`;
  await runMutation("取消任务", async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/cancel`,
      { idempotency_key: ensureAttempt(attemptKey), actor: "human" },
    );
    attemptStore.delete(attemptKey);
  });
}

async function resolveGate(gateId, option) {
  if (!state.exact) return;
  const attemptKey = `gate:${state.exact.change_set_id}:${gateId}:${option}`;
  await runMutation("提交人工判断", async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/gates/${encodeURIComponent(gateId)}/resolve`,
      { idempotency_key: ensureAttempt(attemptKey), option, actor: "human" },
    );
    attemptStore.delete(attemptKey);
  });
}

async function decideBundle(decision) {
  const bundle = state.exact?.bundle;
  if (!bundle) return;
  const attemptKey = `bundle:${state.exact.change_set_id}:${bundle.revision}:${bundle.bundle_hash}:${decision}`;
  await runMutation(decision === "accept" ? "接受候选" : "放弃任务", async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/bundle-decisions`,
      {
        idempotency_key: ensureAttempt(attemptKey),
        bundle_revision: bundle.revision,
        bundle_hash: bundle.bundle_hash,
        decision,
        actor: "human",
      },
    );
    attemptStore.delete(attemptKey);
  });
}

async function publishDelivery() {
  const bundle = state.exact?.bundle;
  if (!bundle) return;
  const attemptKey = `publish:${state.exact.change_set_id}:${bundle.bundle_id}`;
  await runMutation("创建 Ready PR", async () => {
    const result = await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/delivery/publish`,
      { idempotency_key: ensureAttempt(attemptKey), actor: "human", title: null, body: null },
    );
    if (deliveryComplete(result)) attemptStore.delete(attemptKey);
  });
}

async function refreshDelivery() {
  const bundle = state.exact?.bundle;
  if (!bundle) return;
  const attemptKey = `refresh:${state.exact.change_set_id}:${bundle.bundle_id}`;
  await runMutation("刷新交付状态", async () => {
    const result = await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/delivery/refresh`,
      { idempotency_key: ensureAttempt(attemptKey) },
    );
    if (deliveryComplete(result)) attemptStore.delete(attemptKey);
  });
}

async function configureDeliveryBinding() {
  if (!state.exact) return;
  const repositoryId = document.querySelector("#delivery-binding-repository")?.value;
  const githubRepository = document.querySelector("#delivery-binding-github")?.value.trim();
  const pushRemote = document.querySelector("#delivery-binding-remote")?.value.trim();
  if (!repositoryId || !githubRepository || !pushRemote) return;
  const attemptKey = `binding:${state.exact.project_id}:${repositoryId}:${githubRepository}:${pushRemote}`;
  await runMutation("确认 GitHub 交付绑定", async () => {
    await apiPost(
      `/api/local/v0/projects/${encodeURIComponent(state.exact.project_id)}/repositories/${encodeURIComponent(repositoryId)}/github-delivery`,
      {
        idempotency_key: ensureAttempt(attemptKey),
        github_repository: githubRepository,
        push_remote: pushRemote,
      },
    );
    attemptStore.delete(attemptKey);
  });
}

async function runMutation(label, work) {
  state.pendingAction = label;
  await withLoading(async () => {
    await work();
    if (state.selectedChangeSetId) {
      state.list = await apiGet("/api/local/v0/changesets?limit=20");
      await loadExact(state.selectedChangeSetId);
    }
  });
  state.pendingAction = null;
  render();
}

async function openAuditDialog() {
  if (!state.exact) return;
  state.audit = await apiGet(
    `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/audit`,
  );
  const audit = state.audit;
  elements.auditContent.innerHTML = `
    <div class="section-title"><div><p class="eyebrow">Audit</p><h2>任务审计</h2></div><button id="close-audit" class="icon-button" type="button">×</button></div>
    <div class="metric-grid">${Object.entries(compactMetrics(audit))
      .map(([key, value]) => `<div><span>${escapeHtml(metricLabel(key))}</span><strong>${escapeHtml(formatNumber(value))}</strong></div>`)
      .join("")}</div>
    <details open><summary>运行明细</summary><pre>${escapeHtml(JSON.stringify(audit.payload.runs, null, 2))}</pre></details>
    <details><summary>验证与结果</summary><pre>${escapeHtml(JSON.stringify({ validation: audit.payload.validation, outcomes: audit.payload.outcomes, bundle_reviews: audit.payload.bundle_reviews }, null, 2))}</pre></details>
    <details><summary>精确审计身份</summary><pre>${escapeHtml(JSON.stringify({ source_identity: audit.source_identity, payload_digest: audit.payload_digest, generated_at: audit.generated_at }, null, 2))}</pre></details>`;
  document.querySelector("#close-audit")?.addEventListener("click", () =>
    elements.auditDialog.close(),
  );
  elements.auditDialog.showModal();
}

function startLiveStream(changeSetId) {
  state.streamController?.abort();
  const controller = new AbortController();
  state.streamController = controller;
  void consumeLiveStream(changeSetId, controller);
}

async function consumeLiveStream(changeSetId, controller) {
  while (!controller.signal.aborted && state.selectedChangeSetId === changeSetId) {
    try {
      const response = await fetch(
        `/api/local/v0/changesets/${encodeURIComponent(changeSetId)}/events`,
        { headers: sessionHeaders(), signal: controller.signal },
      );
      if (!response.ok || !response.body) throw new Error("实时事件连接失败。");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replaceAll("\r", "");
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n");
          if (data) receiveLiveProjection(JSON.parse(data));
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      state.error = error;
      renderStatus();
    }
    await delay(1_200, controller.signal);
  }
}

function receiveLiveProjection(projection) {
  if (projection.change_set_id !== state.selectedChangeSetId) return;
  state.live = projection;
  const panel = document.querySelector("#live-panel");
  if (panel) panel.innerHTML = renderLivePanel();
  renderStatus();
  if (state.exact && projection.state_updated_at !== state.exact.updated_at) {
    void refreshExactQuietly();
  }
}

async function refreshExactQuietly() {
  if (state.quietRefreshing || !state.selectedChangeSetId) return;
  state.quietRefreshing = true;
  const changeSetId = state.selectedChangeSetId;
  try {
    const [exact, list] = await Promise.all([
      apiGet(`/api/local/v0/changesets/${encodeURIComponent(changeSetId)}`),
      apiGet("/api/local/v0/changesets?limit=20"),
    ]);
    if (state.selectedChangeSetId !== changeSetId) return;
    state.exact = exact;
    state.list = list;
    clearFinishedAttempts();
    render();
  } catch (error) {
    state.error = error;
    renderStatus();
  } finally {
    state.quietRefreshing = false;
  }
}

function compactMetrics(audit) {
  const outcomes = audit?.payload?.outcomes ?? {};
  const attempts = outcomes.runtime_attempts ?? {};
  const feedback = outcomes.feedback_execution ?? {};
  return {
    tokens: audit?.payload?.usage?.observed_total_tokens ?? 0,
    runs: audit?.payload?.runs?.referenced_count ?? 0,
    failures: (attempts.failed ?? 0) + (attempts.interrupted ?? 0) + (attempts.cancelled ?? 0),
    rework: Object.values(feedback).reduce((sum, value) => sum + value, 0),
    duration_ms: audit?.payload?.timing?.provider_duration_sum?.observed_sum ?? 0,
  };
}

function taskStatus(item) {
  const projected = {
    running: { kind: "running", label: "进行中" },
    needs_feedback: { kind: "warn", label: "待反馈" },
    needs_review: { kind: "warn", label: "待审查" },
    waiting_for_merge: { kind: "running", label: "等待合入" },
    complete: { kind: "complete", label: "已完成" },
    cancelled: { kind: "danger", label: "已取消" },
  }[item.operator_status];
  if (projected) return projected;
  return { kind: "running", label: "进行中" };
}

function runtimeLabel(profile) {
  if (!profile) return "默认 Runtime";
  return [profile.runtime, profile.model].filter(Boolean).join(" · ");
}

function stageLabel(value) {
  return ({ planning: "规划", running: "执行", execution: "执行", verification: "验证", review: "审查", supervision: "监督", terminal: "结束" })[value] ?? String(value ?? "任务");
}

function stageAgentLabel(value) {
  return `${stageLabel(value)} Agent`;
}

function activityLabel(event) {
  if (!event) return "正在准备";
  if (event.item_type === "command_execution") return event.exit_code === null ? "正在执行命令" : `命令结束 (${event.exit_code})`;
  if (event.item_type === "file_change") return `已更新 ${event.change_count ?? 0} 处文件`;
  if (event.item_type === "todo_list") return "已更新任务进度";
  if (event.type === "provider.turn.completed") return "Agent 回合已完成";
  return "正在处理";
}

function deliveryLabel(value) {
  return ({ ready: "可交付", running: "等待合并", blocked: "交付受阻", complete: "已合并" })[value] ?? value;
}

function metricLabel(value) {
  return ({ tokens: "Token 总计", runs: "运行次数", failures: "失败/中断", rework: "返工次数", duration_ms: "Provider 时长 (ms)" })[value] ?? value;
}

function formatRelativeTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "未知时间";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} 小时前`;
  return `${Math.floor(seconds / 86_400)} 天前`;
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("zh-CN");
}

// 顶部只展示便于快速判断成本的累计 Provider 时长，精确毫秒仍保留在审计视图。
function formatDuration(value) {
  const milliseconds = Number(value ?? 0);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "0 秒";
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${remainingSeconds} 秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours} 小时` : `${hours} 小时 ${remainingMinutes} 分`;
}

function nullableValue(selector) {
  const value = document.querySelector(selector)?.value.trim() ?? "";
  return value.length === 0 ? null : value;
}

function ensurePendingCreate(draft) {
  const fingerprint = JSON.stringify(draft);
  const existing = readJsonStorage("changefleet:create:pending");
  if (existing?.fingerprint === fingerprint) return existing;
  const pending = {
    fingerprint,
    draft,
    change_set_id: `change-${globalThis.crypto.randomUUID()}`,
    idempotency_key: globalThis.crypto.randomUUID(),
  };
  writeJsonStorage("changefleet:create:pending", pending);
  return pending;
}

function clearPendingCreate() {
  globalThis.localStorage.removeItem("changefleet:create:pending");
}

function readJsonStorage(key) {
  const value = globalThis.localStorage.getItem(key);
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    globalThis.localStorage.removeItem(key);
    return null;
  }
}

function writeJsonStorage(key, value) {
  globalThis.localStorage.setItem(key, JSON.stringify(value));
}

function ensureAttempt(key) {
  const existing = attemptStore.get(key);
  if (existing) return existing;
  const value = globalThis.crypto.randomUUID();
  attemptStore.set(key, value);
  return value;
}

function clearFinishedAttempts() {
  const bundle = state.exact?.bundle;
  if (!bundle) return;
  if (state.exact.task_control?.current_command?.status === "failed") {
    // 后台发布失败后必须为人工重试分配新命令身份，不能重放已失败的幂等键。
    attemptStore.delete(`publish:${state.exact.change_set_id}:${bundle.bundle_id}`);
  }
  if (deliveryComplete(state.exact.delivery)) {
    attemptStore.delete(`publish:${state.exact.change_set_id}:${bundle.bundle_id}`);
    attemptStore.delete(`refresh:${state.exact.change_set_id}:${bundle.bundle_id}`);
  }
}

function deliveryComplete(delivery) {
  return (
    Array.isArray(delivery?.deliveries) &&
    delivery.deliveries.length > 0 &&
    delivery.deliveries.every((item) => item.state === "merged")
  );
}

async function apiGet(path) {
  const response = await fetch(path, { headers: sessionHeaders() });
  return parseResponse(response);
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { ...sessionHeaders(), "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return parseResponse(response);
}

function sessionHeaders() {
  return {
    "X-ChangeFleet-Session": bootstrap.session_nonce,
    "X-ChangeFleet-CSRF": bootstrap.csrf_nonce,
  };
}

async function parseResponse(response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
  return payload;
}

function delay(milliseconds, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function pillClass(value) {
  if (["danger", "failed", "blocked"].includes(value)) return "danger";
  if (["warn", "waiting"].includes(value)) return "warn";
  if (["running"].includes(value)) return "running";
  if (["complete"].includes(value)) return "complete";
  return "";
}

function updateLocation(changeSetId) {
  const url = new URL(globalThis.location.href);
  if (changeSetId === null) url.searchParams.delete("change_set_id");
  else url.searchParams.set("change_set_id", changeSetId);
  globalThis.history.replaceState({}, "", url);
}

function cssAttribute(value) {
  return globalThis.CSS.escape(String(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function readBootstrap() {
  const element = document.querySelector("#changefleet-bootstrap");
  if (!(element instanceof HTMLScriptElement)) throw new Error("缺少 ChangeFleet 启动信息。");
  return JSON.parse(element.textContent ?? "{}");
}
