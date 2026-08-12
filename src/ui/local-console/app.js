const bootstrap = readBootstrap();

// 浏览器模块只维护展示状态、确认步骤与 attempt identity；精确语义、幂等与持久化仍由共享应用操作负责。
const state = {
  intake: null,
  list: null,
  selectedChangeSetId: bootstrap.selected_change_set_id ?? null,
  exact: null,
  audit: null,
  createMode: false,
  createProjectId: null,
  loading: false,
  pendingAction: null,
  error: null,
};

const elements = {
  list: document.querySelector("#changeset-list"),
  detail: document.querySelector("#changeset-detail"),
  loadMore: document.querySelector("#load-more"),
  newChangeSet: document.querySelector("#new-changeset"),
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
elements.newChangeSet.addEventListener("click", () => showCreateForm());
void loadInitial();

async function loadInitial() {
  await withLoading(async () => {
    [state.intake, state.list] = await Promise.all([
      apiGet("/api/local/v0/intake/options"),
      apiGet("/api/local/v0/changesets?limit=20"),
    ]);
    state.createProjectId =
      readPendingCreate()?.draft?.project_id ??
      state.intake.projects[0]?.project_id ??
      null;
    if (!state.selectedChangeSetId && state.list.items.length > 0) {
      state.selectedChangeSetId = state.list.items[0].change_set_id;
    }
    if (state.selectedChangeSetId) {
      await loadExact(state.selectedChangeSetId);
    } else {
      state.createMode = true;
    }
  });
}

function showCreateForm() {
  state.createMode = true;
  state.selectedChangeSetId = null;
  state.exact = null;
  state.audit = null;
  updateLocation(null);
  render();
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
  state.createMode = false;
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
    elements.newChangeSet.disabled = true;
    return;
  }
  elements.list.innerHTML = state.list.items
    .map(
      (item) => `
        <article class="changeset-card ${item.change_set_id === state.selectedChangeSetId ? "active" : ""}" data-change-set-id="${escapeHtml(item.change_set_id)}">
          <div class="row">
            <strong>${escapeHtml(item.change_set_id)}</strong>
            <span class="pill ${pillClass(item.activity)}">${escapeHtml(`${item.phase} / ${item.activity}`)}</span>
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
  elements.newChangeSet.disabled =
    state.loading || (state.intake?.projects.length ?? 0) === 0;
}

function renderDetail() {
  if (state.createMode) {
    renderCreateForm();
    return;
  }
  if (!state.exact || !state.audit) {
    elements.detail.innerHTML = '<div class="empty">Select one ChangeSet.</div>';
    return;
  }
  const bundle = state.exact.bundle;
  const qualityReview = bundle?.quality_review ?? null;
  const bundleReviewRequired =
    state.exact.plan?.bundle_review?.mode === "independent";
  const explicitBundleGate = state.exact.gates.some((gate) =>
    ["bundle_review_decision", "bundle_review_failure"].includes(gate.kind),
  );
  const bundleAcceptable =
    !bundleReviewRequired ||
    ["pass", "gate"].includes(qualityReview?.disposition) ||
    explicitBundleGate;
  const canAdvance =
    state.exact.phase === "working" ||
    (state.exact.phase === "review" &&
      bundleReviewRequired &&
      qualityReview === null &&
      !explicitBundleGate);
  const planningMessage = state.exact.planning_message;
  const planningConversation = state.exact.planning_conversation;
  const pendingPlanning = readPendingPlanning(state.exact.change_set_id);
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
          <span class="pill ${pillClass(state.exact.activity)}">${escapeHtml(`${state.exact.phase} / ${state.exact.activity}`)}</span>
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
              bundle_reviews: state.audit.payload.bundle_reviews,
            },
            null,
            2,
          ),
        )}</pre>
      </article>
    </div>
    <section class="section">
      <div class="actions">
        ${
          state.exact.supervision.mode === "autonomous_until_review"
            ? `
              <button id="${state.exact.supervision.held ? "resume-supervision" : "start-supervision"}" type="button" ${canAdvance ? "" : "disabled"}>${state.exact.supervision.held ? "Resume Autonomous Work" : "Run Autonomously To Review"}</button>
              <button id="pause-supervision" class="secondary" type="button" ${state.exact.phase === "working" && !state.exact.supervision.held ? "" : "disabled"}>Pause After Current Action</button>
            `
            : `<button id="continue-change-set" type="button" ${canAdvance ? "" : "disabled"}>Start or Continue Eligible Work</button>`
        }
      </div>
      <div class="muted">Supervision ${escapeHtml(state.exact.supervision.mode)}; last stop ${escapeHtml(state.exact.supervision.last_stop_reason ?? "none")}.</div>
    </section>
    <section class="section stack">
      <div class="row">
        <h3>Planning Conversation</h3>
        <span class="pill">${escapeHtml(
          `${planningConversation.shown_turns}/${planningConversation.total_turns} turns`,
        )}</span>
      </div>
      <div class="conversation">
        ${
          planningConversation.turns.length === 0
            ? '<div class="summary-box muted">No planning turn yet.</div>'
            : planningConversation.turns.map(renderPlanningTurn).join("")
        }
      </div>
      ${
        planningConversation.truncated
          ? '<p class="muted">Older or oversized planning text remains linked audit evidence and is not loaded here.</p>'
          : ""
      }
      ${
        state.exact.phase === "planning"
          ? `
            <form id="planning-message-form" class="planning-composer">
              <label class="field">
                <span>${planningConversation.total_turns === 0 ? "Start planning" : "Reply to Planner"}</span>
                <textarea id="planning-message-input" rows="3" placeholder="${
                  planningConversation.total_turns === 0
                    ? "Optional initial guidance; the confirmed intent is already available."
                    : "Describe the required clarification or revision."
                }">${escapeHtml(pendingPlanning?.message ?? "")}</textarea>
              </label>
              <div class="actions">
                <button id="send-planning-message" type="submit">${
                  planningConversation.total_turns === 0
                    ? "Start Planning"
                    : "Send Planning Message"
                }</button>
              </div>
            </form>`
          : ""
      }
      ${
        planningMessage
          ? `
            <div class="summary-box exact-plan-subject">
              <div class="row">
                <strong>Exact approval subject</strong>
                <span class="pill">current</span>
              </div>
              <p>Message <code>${escapeHtml(planningMessage.message_id)}</code></p>
              <p>Digest <code>${escapeHtml(planningMessage.content_digest)}</code></p>
              <pre>${escapeHtml(JSON.stringify(planningMessage.plan, null, 2))}</pre>
              <div class="actions">
                <button id="confirm-plan" type="button">Approve Exact Plan Message</button>
              </div>
            </div>
          `
          : '<div class="summary-box muted">No Plan-bearing message is currently awaiting approval.</div>'
      }
    </section>
    <section class="section stack">
      <div class="row">
        <h3>Work Units</h3>
        <span class="pill">current plan</span>
      </div>
      <div class="cards">
        ${
          state.exact.work_units.length === 0
            ? '<div class="summary-box muted">No current WorkUnits.</div>'
            : state.exact.work_units
                .map(
                  (unit) => `
                    <article class="candidate-card">
                      <div class="row">
                        <strong>${escapeHtml(unit.work_unit_id)}</strong>
                        <span class="pill ${pillClass(unit.activity)}">${escapeHtml(`${unit.phase} / ${unit.activity}`)}</span>
                      </div>
                      <div>Repository ${escapeHtml(unit.repository_id)}</div>
                      <div>Pending feedback <code>${escapeHtml(unit.pending_feedback_id ?? "none")}</code></div>
                      <div>Candidate <code>${escapeHtml(unit.candidate_id ?? "none")}</code></div>
                      <div class="actions">
                        <button class="secondary submit-feedback" type="button" data-work-unit-id="${escapeAttribute(unit.work_unit_id)}" data-run-id="${escapeAttribute(unit.active_run_id ?? "")}">Submit Feedback</button>
                        ${unit.active_run_id ? `<button class="danger interrupt-run" type="button" data-run-id="${escapeAttribute(unit.active_run_id)}">Interrupt Run</button>` : ""}
                      </div>
                    </article>
                  `,
                )
                .join("")
        }
      </div>
    </section>
    <section class="section stack">
      <div class="row">
        <h3>Open Gates</h3>
        <span class="pill">human input</span>
      </div>
      <div class="cards">
        ${
          state.exact.gates.length === 0
            ? '<div class="summary-box muted">No open Gates.</div>'
            : state.exact.gates
                .map(
                  (gate) => `
                    <article class="candidate-card">
                      <strong>${escapeHtml(gate.question ?? gate.kind)}</strong>
                      <div><code>${escapeHtml(gate.gate_id)}</code></div>
                      <div>WorkUnit ${escapeHtml(gate.work_unit_id ?? "none")}</div>
                      <div>Options: ${gate.options.map(escapeHtml).join(", ")}</div>
                      <div class="actions">
                        ${gate.options
                          .map(
                            (option) => `<button class="secondary resolve-gate" type="button" data-gate-id="${escapeAttribute(gate.gate_id)}" data-option="${escapeAttribute(option)}">${escapeHtml(option)}</button>`,
                          )
                          .join("")}
                      </div>
                    </article>
                  `,
                )
                .join("")
        }
      </div>
    </section>
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
              <p>Quality review <span class="pill ${pillClass(qualityReview?.disposition ?? "waiting")}">${escapeHtml(qualityReview?.disposition ?? (bundleReviewRequired ? "required" : "not required"))}</span></p>
              ${
                qualityReview
                  ? `<p>${escapeHtml(qualityReview.summary)}</p><pre>${escapeHtml(JSON.stringify(qualityReview.findings, null, 2))}</pre>`
                  : ""
              }
              <p class="muted">Confirmation binds the exact revision, hash, candidate ids, SHAs, changed paths, and available evidence references.</p>
              <div class="actions">
                <button id="accept-bundle" type="button" ${bundleAcceptable ? "" : "disabled"}>Accept Bundle</button>
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
        <div>Current phase <span class="pill ${pillClass(delivery.activity)}">${escapeHtml(`${delivery.phase} / ${delivery.activity}`)}</span></div>
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
    .querySelector("#confirm-plan")
    ?.addEventListener("click", () => void confirmPlanMessage());
  document
    .querySelector("#planning-message-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      void sendPlanningMessage();
    });
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
  document
    .querySelector("#continue-change-set")
    ?.addEventListener("click", () => void continueChangeSet());
  document
    .querySelector("#start-supervision")
    ?.addEventListener("click", () => void mutateSupervision("start"));
  document
    .querySelector("#resume-supervision")
    ?.addEventListener("click", () => void mutateSupervision("resume"));
  document
    .querySelector("#pause-supervision")
    ?.addEventListener("click", () => void mutateSupervision("pause"));
  for (const button of document.querySelectorAll(".submit-feedback")) {
    button.addEventListener("click", () =>
      void submitFeedback(
        button.dataset.workUnitId,
        button.dataset.runId || null,
      ),
    );
  }
  for (const button of document.querySelectorAll(".interrupt-run")) {
    button.addEventListener("click", () =>
      void interruptRun(button.dataset.runId),
    );
  }
  for (const button of document.querySelectorAll(".resolve-gate")) {
    button.addEventListener("click", () =>
      void resolveGate(button.dataset.gateId, button.dataset.option),
    );
  }
}

function renderPlanningTurn(turn) {
  const user = turn.user_message;
  const assistant = turn.assistant_message;
  return `
    <article class="conversation-turn">
      ${
        user === null
          ? ""
          : `<div class="message human-message">
              <strong>Human</strong>
              <p>${escapeHtml(user.text)}</p>
              ${user.truncated ? '<span class="pill warn">truncated</span>' : ""}
            </div>`
      }
      <div class="message agent-message">
        <div class="row">
          <strong>Planner</strong>
          <div class="actions">
            ${assistant.has_plan ? '<span class="pill">Plan</span>' : ""}
            ${assistant.is_approvable ? '<span class="pill">approvable</span>' : ""}
            ${assistant.truncated ? '<span class="pill warn">truncated</span>' : ""}
          </div>
        </div>
        <p>${escapeHtml(assistant.text)}</p>
      </div>
    </article>`;
}

function renderCreateForm() {
  const projects = state.intake?.projects ?? [];
  if (projects.length === 0) {
    elements.detail.innerHTML =
      '<div class="empty">Register a Project before creating a ChangeSet.</div>';
    return;
  }
  const pending = readPendingCreate();
  const draft = pending?.draft ?? null;
  if (
    !projects.some((project) => project.project_id === state.createProjectId)
  ) {
    state.createProjectId = draft?.project_id ?? projects[0].project_id;
  }
  const project =
    projects.find((item) => item.project_id === state.createProjectId) ??
    projects[0];
  const selectedRepositoryIds = new Set(
    draft?.project_id === project.project_id
      ? draft.planning_repository_ids
      : project.repositories.map((repository) => repository.repository_id),
  );
  const selections = new Map(
    (draft?.project_id === project.project_id
      ? draft.repository_selections
      : []
    ).map((selection) => [selection.repository_id, selection]),
  );
  elements.detail.innerHTML = `
    <section class="stack">
      <div class="row">
        <div>
          <p class="eyebrow">New exact task</p>
          <h2>Create ChangeSet</h2>
        </div>
        <span class="pill">existing Project</span>
      </div>
      <form id="create-changeset-form" class="stack">
        <label class="field">
          <span>Project</span>
          <select id="create-project" name="project_id">
            ${projects
              .map(
                (item) =>
                  `<option value="${escapeAttribute(item.project_id)}" ${
                    item.project_id === project.project_id ? "selected" : ""
                  }>${escapeHtml(item.project_id)}${
                    item.description ? ` — ${escapeHtml(item.description)}` : ""
                  }</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="field">
          <span>Objective</span>
          <textarea id="create-objective" rows="4" required>${escapeHtml(
            draft?.project_id === project.project_id
              ? draft.intent.objective
              : "",
          )}</textarea>
        </label>
        <label class="field">
          <span>Rationale <small>optional</small></span>
          <textarea id="create-rationale" rows="2">${escapeHtml(
            draft?.project_id === project.project_id
              ? draft.intent.rationale ?? ""
              : "",
          )}</textarea>
        </label>
        <div class="summary-grid">
          <label class="field">
            <span>Constraints <small>one per line</small></span>
            <textarea id="create-constraints" rows="3">${escapeHtml(
              draft?.project_id === project.project_id
                ? draft.intent.constraints.join("\n")
                : "",
            )}</textarea>
          </label>
          <label class="field">
            <span>Acceptance criteria <small>one per line</small></span>
            <textarea id="create-acceptance" rows="3">${escapeHtml(
              draft?.project_id === project.project_id
                ? draft.intent.acceptance_criteria.join("\n")
                : "",
            )}</textarea>
          </label>
        </div>
        <section class="stack">
          <div>
            <h3>Repositories</h3>
            <p class="muted">Select at least one. Empty refs use each checkout's current branch.</p>
          </div>
          ${project.repositories
            .map((repository) => {
              const selection = selections.get(repository.repository_id);
              return `
                <article class="repository-choice" data-repository-choice="${escapeAttribute(
                  repository.repository_id,
                )}">
                  <label class="repository-toggle">
                    <input type="checkbox" data-repository-selected="${escapeAttribute(
                      repository.repository_id,
                    )}" ${
                      selectedRepositoryIds.has(repository.repository_id)
                        ? "checked"
                        : ""
                    }>
                    <strong>${escapeHtml(repository.repository_id)}</strong>
                    <span class="muted">${escapeHtml(
                      repository.description ?? repository.default_target_ref,
                    )}</span>
                  </label>
                  <div class="summary-grid">
                    <label class="field">
                      <span>Base branch <small>optional</small></span>
                      <input data-branch-ref="${escapeAttribute(
                        repository.repository_id,
                      )}" value="${escapeAttribute(selection?.branch_ref ?? "")}">
                    </label>
                    <label class="field">
                      <span>Delivery target <small>optional</small></span>
                      <input data-target-ref="${escapeAttribute(
                        repository.repository_id,
                      )}" value="${escapeAttribute(selection?.target_ref ?? "")}">
                    </label>
                  </div>
                </article>`;
            })
            .join("")}
        </section>
        <div class="summary-box">
          <h3>Effective task configuration</h3>
          <pre>${escapeHtml(
            JSON.stringify(
              {
                agent_profile: state.intake.agent_profile,
                task_policy: project.task_policy,
              },
              null,
              2,
            ),
          )}</pre>
        </div>
        <div class="actions">
          <button id="create-and-plan" type="submit">Create and Start Planning</button>
        </div>
      </form>
    </section>`;
  document
    .querySelector("#create-project")
    ?.addEventListener("change", (event) => {
      state.createProjectId = event.target.value;
      clearPendingCreate();
      renderCreateForm();
    });
  document
    .querySelector("#create-changeset-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      void createAndStartPlanning(project);
    });
}

async function createAndStartPlanning(project) {
  const selectedIds = Array.from(
    document.querySelectorAll("[data-repository-selected]:checked"),
  ).map((element) => element.dataset.repositorySelected);
  const objective = document.querySelector("#create-objective")?.value.trim();
  if (!objective) {
    state.error = new Error("Objective is required.");
    render();
    return;
  }
  if (selectedIds.length === 0) {
    state.error = new Error("Select at least one Repository.");
    render();
    return;
  }
  const draft = {
    project_id: project.project_id,
    intent: {
      objective,
      rationale: nullableInputValue("#create-rationale"),
      constraints: inputLines("#create-constraints"),
      non_goals: [],
      acceptance_criteria: inputLines("#create-acceptance"),
      resolved_decisions: [],
      open_questions: [],
    },
    planning_repository_ids: selectedIds,
    repository_selections: selectedIds.map((repositoryId) => ({
      repository_id: repositoryId,
      branch_ref: nullableInputValue(
        `[data-branch-ref="${cssAttribute(repositoryId)}"]`,
      ),
      target_ref: nullableInputValue(
        `[data-target-ref="${cssAttribute(repositoryId)}"]`,
      ),
    })),
  };
  const pending = ensurePendingCreate(draft);
  state.pendingAction = "ChangeSet creation and initial planning";
  await withLoading(async () => {
    await apiPost("/api/local/v0/changesets", {
      idempotency_key: pending.idempotency_key,
      change_set_id: pending.change_set_id,
      ...draft,
    });
    clearPendingCreate();
    state.selectedChangeSetId = pending.change_set_id;
    state.list = await apiGet("/api/local/v0/changesets?limit=20");

    // 创建已经成为权威事实后，规划失败只能保留并重试同一任务，不能自动新建替代任务。
    let planningError = null;
    const planning = ensurePendingPlanning(pending.change_set_id, null);
    try {
      await apiPost(
        `/api/local/v0/changesets/${encodeURIComponent(
          pending.change_set_id,
        )}/planning-messages`,
        { idempotency_key: planning.idempotency_key, message: null },
      );
      clearPendingPlanning(pending.change_set_id);
    } catch (error) {
      planningError = error;
    }
    await loadExact(pending.change_set_id);
    if (planningError) throw planningError;
  });
  state.pendingAction = null;
  render();
}

async function sendPlanningMessage() {
  if (!state.exact || state.exact.phase !== "planning") return;
  const input = document.querySelector("#planning-message-input");
  const text = input?.value.trim() ?? "";
  const message =
    state.exact.planning_conversation.total_turns === 0 && text.length === 0
      ? null
      : text;
  if (message === "") {
    state.error = new Error("A planning reply cannot be empty.");
    render();
    return;
  }
  const pending = ensurePendingPlanning(state.exact.change_set_id, message);
  await runMutation("planning message", async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(
        state.exact.change_set_id,
      )}/planning-messages`,
      {
        idempotency_key: pending.idempotency_key,
        message,
      },
    );
    clearPendingPlanning(state.exact.change_set_id);
  });
}

function inputLines(selector) {
  return (document.querySelector(selector)?.value ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function nullableInputValue(selector) {
  const value = document.querySelector(selector)?.value.trim() ?? "";
  return value.length === 0 ? null : value;
}

function ensurePendingCreate(draft) {
  const fingerprint = JSON.stringify(draft);
  const existing = readPendingCreate();
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

function readPendingCreate() {
  return readJsonStorage("changefleet:create:pending");
}

function clearPendingCreate() {
  globalThis.localStorage.removeItem("changefleet:create:pending");
}

function ensurePendingPlanning(changeSetId, message) {
  const existing = readPendingPlanning(changeSetId);
  if (existing && existing.message === message) return existing;
  const pending = {
    message,
    idempotency_key: globalThis.crypto.randomUUID(),
  };
  writeJsonStorage(`changefleet:planning:${changeSetId}`, pending);
  return pending;
}

function readPendingPlanning(changeSetId) {
  return readJsonStorage(`changefleet:planning:${changeSetId}`);
}

function clearPendingPlanning(changeSetId) {
  globalThis.localStorage.removeItem(`changefleet:planning:${changeSetId}`);
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

function cssAttribute(value) {
  return globalThis.CSS.escape(String(value));
}

async function continueChangeSet() {
  if (!state.exact || !["working", "review"].includes(state.exact.phase)) return;
  const attemptKey = `execute:${state.exact.change_set_id}:${state.exact.updated_at}`;
  const attemptId = ensureAttempt(attemptKey);
  await runMutation("continue work", async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/execute`,
      {
        idempotency_key: attemptId,
        verification_admission_mode: null,
        validation_attempt_budgets: [],
      },
    );
    attemptStore.delete(attemptKey);
  });
}

async function mutateSupervision(operation) {
  if (!state.exact || !["working", "review"].includes(state.exact.phase)) return;
  const attemptKey = `supervision:${operation}:${state.exact.change_set_id}:${state.exact.updated_at}`;
  const attemptId = ensureAttempt(attemptKey);
  await runMutation(`${operation} supervision`, async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/supervision/${operation}`,
      {
        idempotency_key: attemptId,
        actor: "human",
        ...(operation === "pause" ? { reason: "operator_hold" } : {}),
      },
    );
    attemptStore.delete(attemptKey);
  });
}

async function submitFeedback(workUnitId, runId) {
  if (!state.exact) return;
  const summary = globalThis.prompt("Concise feedback summary");
  if (!summary?.trim()) return;
  const finding = globalThis.prompt("Actionable finding");
  if (!finding?.trim()) return;
  const attemptKey = `feedback:${state.exact.change_set_id}:${workUnitId}:${state.exact.updated_at}`;
  const attemptId = ensureAttempt(attemptKey);
  await runMutation("submit feedback", async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/feedback`,
      {
        idempotency_key: attemptId,
        phase: state.exact.phase,
        work_unit_id: workUnitId,
        run_id: runId,
        feedback: {
          summary: summary.trim(),
          findings: [{ finding_id: "human-feedback", text: finding.trim() }],
        },
        actor: "human",
      },
    );
    attemptStore.delete(attemptKey);
  });
}

async function interruptRun(runId) {
  if (!state.exact || !runId) return;
  if (!globalThis.confirm(`Interrupt active Run ${runId}?`)) return;
  const attemptKey = `interrupt:${state.exact.change_set_id}:${runId}`;
  const attemptId = ensureAttempt(attemptKey);
  await runMutation("interrupt run", async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/runs/${encodeURIComponent(runId)}/interrupt`,
      { idempotency_key: attemptId, actor: "human" },
    );
    attemptStore.delete(attemptKey);
  });
}

async function resolveGate(gateId, option) {
  if (!state.exact || !gateId || !option) return;
  if (!globalThis.confirm(`Resolve Gate ${gateId} with ${option}?`)) return;
  const attemptKey = `gate:${state.exact.change_set_id}:${gateId}:${option}`;
  const attemptId = ensureAttempt(attemptKey);
  await runMutation("resolve gate", async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/gates/${encodeURIComponent(gateId)}/resolve`,
      { idempotency_key: attemptId, option, actor: "human" },
    );
    attemptStore.delete(attemptKey);
  });
}

async function confirmPlanMessage() {
  const message = state.exact?.planning_message;
  if (!message) return;
  if (
    !globalThis.confirm(
      `Approve exact plan message ${message.message_id}\n${message.content_digest}`,
    )
  ) {
    return;
  }
  const attemptKey = `plan:${state.exact.change_set_id}:${message.message_id}:${message.content_digest}`;
  const attemptId = ensureAttempt(attemptKey);
  await runMutation("plan approval", async () => {
    await apiPost(
      `/api/local/v0/changesets/${encodeURIComponent(state.exact.change_set_id)}/plan-confirmation`,
      {
        idempotency_key: attemptId,
        message_id: message.message_id,
        content_digest: message.content_digest,
        actor: "human",
      },
    );
    attemptStore.delete(attemptKey);
  });
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
  if (changeSetId === null) url.searchParams.delete("change_set_id");
  else url.searchParams.set("change_set_id", changeSetId);
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
