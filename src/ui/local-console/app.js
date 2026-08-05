const bootstrap = readBootstrap();

// 浏览器模块只维护展示状态、确认步骤与 attempt identity；精确语义、幂等与持久化仍由共享应用操作负责。
const state = {
  list: null,
  selectedChangeSetId: bootstrap.selected_change_set_id ?? null,
  exact: null,
  audit: null,
  loading: false,
  pendingAction: null,
  error: null,
};

const elements = {
  list: document.querySelector("#changeset-list"),
  detail: document.querySelector("#changeset-detail"),
  loadMore: document.querySelector("#load-more"),
  status: document.querySelector("#status"),
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
void loadInitial();

async function loadInitial() {
  await withLoading(async () => {
    state.list = await apiGet("/api/local/v0/changesets?limit=20");
    if (!state.selectedChangeSetId && state.list.items.length > 0) {
      state.selectedChangeSetId = state.list.items[0].change_set_id;
    }
    if (state.selectedChangeSetId) {
      await loadExact(state.selectedChangeSetId);
    }
  });
}

async function loadMore() {
  if (!state.list?.next_cursor) return;
  await withLoading(async () => {
    const next = await apiGet(
      `/api/local/v0/changesets?limit=20&cursor=${encodeURIComponent(state.list.next_cursor)}`,
    );
    state.list = {
      ...next,
      items: [...state.list.items, ...next.items],
    };
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
  clearFinishedAttempts();
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
  const base = state.loading
    ? "Loading exact local state."
    : "Loopback only, same-origin session required, and ordinary GET stays side-effect free.";
  elements.status.textContent =
    state.pendingAction === null ? base : `${base} Pending ${state.pendingAction}.`;
  elements.status.className = state.error ? "status error" : "status";
  if (state.error) {
    elements.status.textContent = state.error.message;
  }
}

function renderList() {
  if (!state.list) {
    elements.list.innerHTML = '<div class="empty">No recent ChangeSets.</div>';
    elements.loadMore.disabled = true;
    return;
  }
  elements.list.innerHTML = state.list.items
    .map(
      (item) => `
        <article class="changeset-card ${item.change_set_id === state.selectedChangeSetId ? "active" : ""}" data-change-set-id="${escapeHtml(item.change_set_id)}">
          <div class="row">
            <strong>${escapeHtml(item.change_set_id)}</strong>
            <span class="pill ${pillClass(item.state)}">${escapeHtml(item.state)}</span>
          </div>
          <p>${escapeHtml(item.current_intent?.objective ?? "No objective")}</p>
          <div class="muted">Project ${escapeHtml(item.project_id)}</div>
          <div class="muted">Updated ${escapeHtml(item.updated_at)}</div>
        </article>
      `,
    )
    .join("");
  for (const card of elements.list.querySelectorAll("[data-change-set-id]")) {
    card.addEventListener("click", () =>
      void withLoading(() => loadExact(card.dataset.changeSetId)),
    );
  }
  elements.loadMore.disabled = !state.list.next_cursor || state.loading;
}

function renderDetail() {
  if (!state.exact || !state.audit) {
    elements.detail.innerHTML = '<div class="empty">Select one ChangeSet.</div>';
    return;
  }
  const bundle = state.exact.bundle;
  const delivery = state.exact.delivery;
  const publishAttempt = bundle
    ? attemptStore.get(`publish:${state.exact.change_set_id}:${bundle.bundle_id}`)
    : null;
  const refreshAttempt = bundle
    ? attemptStore.get(`refresh:${state.exact.change_set_id}:${bundle.bundle_id}`)
    : null;
  elements.detail.innerHTML = `
    <div class="summary-grid">
      <article class="summary-box">
        <div class="row">
          <h2>${escapeHtml(state.exact.change_set_id)}</h2>
          <span class="pill ${pillClass(state.exact.state)}">${escapeHtml(state.exact.state)}</span>
        </div>
        <p>${escapeHtml(state.exact.current_intent?.objective ?? "No objective")}</p>
        <div class="muted">Updated ${escapeHtml(state.exact.updated_at)}</div>
      </article>
      <article class="summary-box">
        <h3>Exact Current State</h3>
        <ul class="meta">
          <li>Intent revision ${escapeHtml(state.exact.current_revisions.intent_revision)}</li>
          <li>Selection revision ${escapeHtml(state.exact.current_revisions.repository_selection_revision)}</li>
          <li>Harness revision ${escapeHtml(state.exact.current_revisions.repository_harness_selection_revision)}</li>
          <li>Plan revision ${escapeHtml(state.exact.current_revisions.plan_revision ?? "none")}</li>
        </ul>
      </article>
      <article class="summary-box">
        <h3>Audit Summary</h3>
        <pre>${escapeHtml(
          JSON.stringify(
            {
              usage: state.audit.payload.usage,
              outcomes: state.audit.payload.outcomes,
              validation: state.audit.payload.validation.outcomes,
            },
            null,
            2,
          ),
        )}</pre>
      </article>
    </div>
    <section class="section stack">
      <div class="row">
        <h3>Bundle Subject</h3>
        ${bundle ? `<span class="pill">rev ${escapeHtml(bundle.revision)}</span>` : ""}
      </div>
      ${
        bundle
          ? `
            <div class="summary-box">
              <p>Bundle hash <code>${escapeHtml(bundle.bundle_hash)}</code></p>
              <p>Combined validation evidence <code>${escapeHtml(bundle.combined_validation_evidence?.evidence_id ?? "missing")}</code></p>
              <p class="muted">Confirmation binds the exact revision, hash, candidate ids, SHAs, changed paths, and available evidence references.</p>
              <div class="actions">
                <button id="accept-bundle" type="button">Accept Bundle</button>
                <button id="reject-bundle" class="danger" type="button">Reject Bundle</button>
              </div>
            </div>
            <div class="cards">
              ${bundle.candidates
                .map(
                  (candidate) => `
                    <article class="candidate-card">
                      <div class="row">
                        <strong>${escapeHtml(candidate.repository_id)}</strong>
                        <span class="pill">${escapeHtml(candidate.target_ref)}</span>
                      </div>
                      <div><code>${escapeHtml(candidate.candidate_id)}</code></div>
                      <div><code>${escapeHtml(candidate.base_sha)}</code> -> <code>${escapeHtml(candidate.candidate_sha)}</code></div>
                      <div>Changed paths: ${candidate.changed_paths.length === 0 ? "none" : candidate.changed_paths.map(escapeHtml).join(", ")}</div>
                      <div>Repository evidence <code>${escapeHtml(candidate.repository_evidence.evidence_id)}</code></div>
                    </article>
                  `,
                )
                .join("")}
            </div>
          `
          : '<div class="summary-box muted">No current exact bundle.</div>'
      }
    </section>
    <section class="section stack">
      <div class="row">
        <h3>GitHub Delivery</h3>
        <div class="actions">
          <button id="publish-delivery" type="button" ${bundle ? "" : "disabled"}>Publish Delivery</button>
          <button id="refresh-delivery" class="secondary" type="button" ${bundle ? "" : "disabled"}>Refresh Delivery</button>
        </div>
      </div>
      <div class="summary-box">
        <div>Current state <span class="pill ${pillClass(delivery.state)}">${escapeHtml(delivery.state)}</span></div>
        <div>Per-repository requests ${escapeHtml(delivery.delivery_count)}</div>
        ${
          publishAttempt
            ? `<div class="muted">Reusing publish attempt <code>${escapeHtml(publishAttempt)}</code> while the result is ambiguous.</div>`
            : ""
        }
        ${
          refreshAttempt
            ? `<div class="muted">Reusing refresh attempt <code>${escapeHtml(refreshAttempt)}</code> while the result is ambiguous.</div>`
            : ""
        }
      </div>
      <div class="cards">
        ${
          delivery.deliveries.length === 0
            ? '<div class="summary-box muted">No delivery requests yet.</div>'
            : delivery.deliveries
                .map(
                  (item) => `
                    <article class="candidate-card">
                      <div class="row">
                        <strong>${escapeHtml(item.repository_id)}</strong>
                        <span class="pill ${pillClass(item.state)}">${escapeHtml(item.state)}</span>
                      </div>
                      <div>Target ${escapeHtml(item.target_ref)}</div>
                      <div>Branch <code>${escapeHtml(item.remote_branch)}</code></div>
                      <div>GitHub ${escapeHtml(item.github_repository)}</div>
                      <div>Candidate <code>${escapeHtml(item.candidate_sha)}</code></div>
                      <div>PR ${
                        item.pull_request
                          ? `<a href="${escapeAttribute(item.pull_request.url)}" target="_blank" rel="noreferrer">#${escapeHtml(item.pull_request.number)}</a>`
                          : "not created"
                      }</div>
                      <div>Last error ${escapeHtml(item.last_error?.code ?? "none")}</div>
                    </article>
                  `,
                )
                .join("")
        }
      </div>
    </section>
    <section class="section summary-grid">
      <article class="summary-box">
        <h3>Repositories</h3>
        <pre>${escapeHtml(JSON.stringify(state.exact.repositories, null, 2))}</pre>
      </article>
      <article class="summary-box">
        <h3>Blockers</h3>
        <pre>${escapeHtml(JSON.stringify(state.exact.blockers, null, 2))}</pre>
      </article>
    </section>
  `;

  document
    .querySelector("#accept-bundle")
    ?.addEventListener("click", () => void decideBundle("accept"));
  document
    .querySelector("#reject-bundle")
    ?.addEventListener("click", () => void decideBundle("reject"));
  document
    .querySelector("#publish-delivery")
    ?.addEventListener("click", () => void publishDelivery());
  document
    .querySelector("#refresh-delivery")
    ?.addEventListener("click", () => void refreshDelivery());
}

async function decideBundle(decision) {
  const bundle = state.exact?.bundle;
  if (!bundle) return;
  if (
    !globalThis.confirm(
      `Confirm ${decision} for bundle revision ${bundle.revision}\n${bundle.bundle_hash}`,
    )
  ) {
    return;
  }
  const attemptKey = `bundle:${state.exact.change_set_id}:${bundle.revision}:${bundle.bundle_hash}:${decision}`;
  const attemptId = ensureAttempt(attemptKey);
  await runMutation(`bundle ${decision}`, async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/bundle-decisions`,
      {
        idempotency_key: attemptId,
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
  if (
    !globalThis.confirm(
      `Publish accepted bundle ${bundle.bundle_id}\nThe same attempt id will be reused while the result remains ambiguous.`,
    )
  ) {
    return;
  }
  const attemptKey = `publish:${state.exact.change_set_id}:${bundle.bundle_id}`;
  const attemptId = ensureAttempt(attemptKey);
  await runMutation("delivery publish", async () => {
    const result = await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/delivery/publish`,
      {
        idempotency_key: attemptId,
        actor: "human",
        title: null,
        body: null,
      },
    );
    if (deliveryComplete(result)) {
      attemptStore.delete(attemptKey);
    }
  });
}

async function refreshDelivery() {
  const bundle = state.exact?.bundle;
  if (!bundle) return;
  const attemptKey = `refresh:${state.exact.change_set_id}:${bundle.bundle_id}`;
  const attemptId = ensureAttempt(attemptKey);
  await runMutation("delivery refresh", async () => {
    const result = await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/delivery/refresh`,
      {
        idempotency_key: attemptId,
      },
    );
    if (deliveryComplete(result)) {
      attemptStore.delete(attemptKey);
    }
  });
}

async function runMutation(label, work) {
  await withLoading(async () => {
    state.pendingAction = label;
    render();
    await work();
    await loadExact(state.selectedChangeSetId);
  });
  state.pendingAction = null;
  render();
}

function clearFinishedAttempts() {
  const bundle = state.exact?.bundle;
  if (!bundle) return;
  if (state.exact.bundle?.human_decision?.decision === "accept") {
    attemptStore.delete(
      `bundle:${state.exact.change_set_id}:${bundle.revision}:${bundle.bundle_hash}:accept`,
    );
  }
  if (state.exact.bundle?.human_decision?.decision === "reject") {
    attemptStore.delete(
      `bundle:${state.exact.change_set_id}:${bundle.revision}:${bundle.bundle_hash}:reject`,
    );
  }
  if (deliveryComplete(state.exact.delivery)) {
    attemptStore.delete(`publish:${state.exact.change_set_id}:${bundle.bundle_id}`);
    attemptStore.delete(`refresh:${state.exact.change_set_id}:${bundle.bundle_id}`);
  }
}

function ensureAttempt(key) {
  const existing = attemptStore.get(key);
  if (existing) return existing;
  const value = globalThis.crypto.randomUUID();
  attemptStore.set(key, value);
  return value;
}

function deliveryComplete(delivery) {
  return (
    Array.isArray(delivery?.deliveries) &&
    delivery.deliveries.length > 0 &&
    delivery.deliveries.every((item) => item.state === "merged")
  );
}

async function apiGet(path) {
  const response = await fetch(path, {
    headers: sessionHeaders(),
  });
  return parseResponse(response);
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      ...sessionHeaders(),
      "Content-Type": "application/json; charset=utf-8",
    },
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
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

function pillClass(value) {
  if (["failed", "rejected", "candidate_diverged", "closed_unmerged"].includes(value)) {
    return "danger";
  }
  if (["decision_required", "integration_stale", "delivering"].includes(value)) {
    return "warn";
  }
  return "";
}

function updateLocation(changeSetId) {
  const url = new URL(globalThis.location.href);
  url.searchParams.set("change_set_id", changeSetId);
  globalThis.history.replaceState({}, "", url);
}

function readBootstrap() {
  const element = document.querySelector("#changefleet-bootstrap");
  if (!(element instanceof HTMLScriptElement)) {
    throw new Error("Missing ChangeFleet bootstrap payload.");
  }
  return JSON.parse(element.textContent ?? "{}");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
