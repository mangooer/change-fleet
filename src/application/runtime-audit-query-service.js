import { sha256, stableId } from "../domain/canonical-json.js";
import {
  DEFAULT_LOCALE,
  diagnosticMessage,
  normalizeLocale,
} from "../domain/diagnostics.js";
import { ChangeFleetError, invariant } from "../domain/errors.js";
import {
  candidateIdentity,
  createValidationSubject,
  normalizeId,
} from "../domain/model.js";
import {
  MAX_AUDIT_RUN_ROWS,
  USAGE_TOKEN_FIELDS,
  createAuditProjection,
  deriveCanonicalUsage,
  elapsedMilliseconds,
} from "../domain/runtime-audit.js";
import { bundleReviewAssessmentMatches } from "../domain/bundle-review.js";

const MAX_BOUNDED_ROWS = 100;
// 查询服务只接收 Store 的 read 能力，构造时不初始化目录，也不持有任何编排或写入端口。
export class RuntimeAuditQueryService {
  constructor({
    controlStore,
    runStore,
    evidenceStore,
    clock = () => new Date(),
    locale = DEFAULT_LOCALE,
  }) {
    requireReader(controlStore, "readChangeSet", "ControlStore");
    requireReader(runStore, "read", "RunStore");
    requireReader(evidenceStore, "read", "EvidenceStore");
    this.controlStore = controlStore;
    this.runStore = runStore;
    this.evidenceStore = evidenceStore;
    this.clock = clock;
    this.locale = normalizeLocale(locale);
  }

  // 单 Run 查询允许仍在运行且尚无终态证据的记录，但终态 Run 缺证据时必须失败关闭。
  async getRunAudit(runId) {
    normalizeId("run_id", runId);
    const loaded = await this.loadRun(runId, { directSource: true });
    return createAuditProjection({
      sourceIdentity: loaded.source_identity,
      queryParameters: { run_id: runId, locale: this.locale },
      payload: loaded.payload,
      generatedAt: this.now(),
    });
  }

  // ChangeSet 总量覆盖全部引用，分页只裁剪明细行，不能改变完整集合的汇总结果。
  async getChangeSetAudit(changeSetId, query = {}) {
    normalizeId("change_set_id", changeSetId);
    const { detailPage, pageSize } = normalizePageQuery(query);
    const state = await this.controlStore.readChangeSet(changeSetId);
    validateChangeSetAuditSource(state, changeSetId);
    const seenRunIds = new Set();
    const loadedRuns = [];
    for (const reference of state.run_references) {
      validateRunReference(reference, changeSetId, seenRunIds);
      loadedRuns.push(
        await this.loadRun(reference.run_id, {
          expectedReference: reference,
          expectedChangeSetId: changeSetId,
        }),
      );
    }
    loadedRuns.sort(compareLoadedRuns);

    const validation = await this.loadValidationEvidence(state);
    const runSourceSet = loadedRuns.map((loaded) => loaded.source_identity);
    const sourceBase = {
      kind: "change_set",
      change_set_id: changeSetId,
      change_set_digest: sha256(state),
      referenced_run_count: loadedRuns.length,
      run_source_set_digest: sha256(runSourceSet),
      validation_source_set_digest: sha256(validation.source_identities),
      current_bundle:
        state.bundles.at(-1) === undefined
          ? null
          : {
              bundle_id: state.bundles.at(-1).bundle_id,
              revision: state.bundles.at(-1).revision,
              bundle_hash: state.bundles.at(-1).bundle_hash,
            },
    };
    const start = (detailPage - 1) * pageSize;
    const payload = {
      identity: {
        change_set_id: state.change_set_id,
        project_id: state.project_id,
        phase: state.phase,
        terminal_outcome: state.terminal_outcome,
        current_intent_revision: state.current_intent_revision,
        current_repository_selection_revision:
          state.current_repository_selection_revision,
        current_repository_harness_selection_revision:
          state.current_repository_harness_selection_revision,
        current_plan_revision: state.current_plan_revision,
      },
      timing: summarizeChangeSetTiming(state, loadedRuns, validation),
      usage: summarizeChangeSetUsage(loadedRuns),
      outcomes: summarizeOutcomes(state, loadedRuns, validation),
      runs: {
        referenced_count: loadedRuns.length,
        detail_page: detailPage,
        page_size: pageSize,
        shown_count: loadedRuns.slice(start, start + pageSize).length,
        omitted_count: Math.max(
          0,
          loadedRuns.length - loadedRuns.slice(start, start + pageSize).length,
        ),
        rows: loadedRuns
          .slice(start, start + pageSize)
          .map((loaded) => runDetailRow(loaded.payload)),
      },
      validation: validation.payload,
      bundles: summarizeBundles(state),
      bundle_reviews: summarizeBundleReviews(state, loadedRuns),
      human_review: summarizeHumanReview(state),
      diagnostics: summarizeDiagnostics(
        loadedRuns.flatMap((loaded) => loaded.payload.usage.diagnostics),
      ),
    };

    return createAuditProjection({
      sourceIdentity: withSourceDigest(sourceBase),
      queryParameters: {
        change_set_id: changeSetId,
        detail_page: detailPage,
        page_size: pageSize,
        locale: this.locale,
      },
      payload,
      generatedAt: this.now(),
    });
  }

  async loadRun(
    runId,
    { directSource = false, expectedReference = null, expectedChangeSetId = null } = {},
  ) {
    const run = await readRequired(
      () => this.runStore.read(runId),
      directSource ? "AUDIT_SOURCE_NOT_FOUND" : "AUDIT_REQUIRED_REFERENCE_INVALID",
      `Run ${runId} could not be read for audit`,
      { run_id: runId },
    );
    invariant(
      run && run.schema_version === 1 && run.run_id === runId,
      "AUDIT_SOURCE_IDENTITY_MISMATCH",
      "Run audit source identity is invalid",
      { run_id: runId },
    );
    validateRunAuditSource(run);
    if (expectedChangeSetId !== null) {
      invariant(
        run.change_set_id === expectedChangeSetId,
        "AUDIT_SOURCE_IDENTITY_MISMATCH",
        "Run belongs to a different ChangeSet",
        { run_id: runId, expected_change_set_id: expectedChangeSetId },
      );
    }
    if (expectedReference !== null) validateRunAgainstReference(run, expectedReference);

    let runtimeEvidence = null;
    if (run.runtime_evidence === null || run.runtime_evidence === undefined) {
      invariant(
        run.status === "running",
        "AUDIT_REQUIRED_REFERENCE_INVALID",
        "A terminal Run must reference immutable Runtime evidence",
        { run_id: runId, status: run.status },
      );
    } else {
      runtimeEvidence = await this.readEvidenceReference(run.runtime_evidence, {
        expectedKind: "runtime_invocation",
        label: `Runtime evidence for ${runId}`,
      });
      validateRuntimeEvidence(run, runtimeEvidence);
    }

    const evidencePayload = runtimeEvidence?.payload ?? null;
    const usage = deriveCanonicalUsage({
      runId,
      usageObservations: evidencePayload?.usage_observations ?? [],
    });
    usage.diagnostics = localizeDiagnostics(usage.diagnostics, this.locale);
    const sourceBase = {
      kind: "run",
      run_id: runId,
      run_digest: sha256(run),
      runtime_evidence:
        runtimeEvidence === null
          ? null
          : evidenceIdentity(runtimeEvidence),
    };
    const payload = createRunPayload(run, evidencePayload, usage);
    payload.change_set_reference =
      expectedReference === null
        ? null
        : {
            status: expectedReference.status,
            plan_revision: expectedReference.plan_revision ?? null,
            work_unit_id: expectedReference.work_unit_id ?? null,
          };
    return {
      source_identity: withSourceDigest(sourceBase),
      payload,
    };
  }

  async loadValidationEvidence(state) {
    const requested = collectValidationReferences(state);
    const records = [];
    for (const item of requested) {
      const record = await this.readEvidenceReference(item.reference, {
        expectedKind: item.expected_kind,
        label: item.label,
      });
      if (item.candidate) validateRepositoryValidationSubject(record, item.candidate);
      if (item.bundle) validateCombinedValidationSubject(record, state, item.bundle);
      if (item.attempt) {
        validateValidationAttemptSubject(record, item.attempt, state);
      }
      records.push({ ...item, record });
    }
    const uniqueRecords = deduplicateEvidence(records);
    const rows = uniqueRecords.map(({ record, attempt }) =>
      validationRow(record, attempt),
    );
    const lifecycleFailures = (state.blockers ?? [])
      .filter((blocker) =>
        [
          "REPOSITORY_VALIDATION_FAILED",
          "COMBINED_VALIDATION_FAILED",
        ].includes(blocker.code),
      )
      .map((blocker) => blocker.code);
    const outcomes = countValues(rows.map((row) => row.status));
    if (lifecycleFailures.length > 0 && outcomes.failed === undefined) {
      outcomes.failed = 1;
    }
    if (rows.length === 0 && lifecycleFailures.length === 0) {
      outcomes.unavailable = 1;
    }
    return {
      source_identities: uniqueRecords.map(({ record }) => evidenceIdentity(record)),
      payload: {
        referenced_count: rows.length,
        shown_count: Math.min(rows.length, MAX_BOUNDED_ROWS),
        omitted_count: Math.max(0, rows.length - MAX_BOUNDED_ROWS),
        rows: rows.slice(0, MAX_BOUNDED_ROWS),
        duration: summarizeNullableNumbers(
          rows.map((row) => row.duration_ms),
        ),
        outcomes: Object.fromEntries(
          Object.entries(outcomes).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
        lifecycle_failure_codes: countValues(lifecycleFailures),
      },
    };
  }

  async readEvidenceReference(reference, { expectedKind, label }) {
    validateEvidenceReferenceShape(reference, expectedKind, label);
    const record = await readRequired(
      () => this.evidenceStore.read(reference.evidence_id),
      "AUDIT_REQUIRED_REFERENCE_INVALID",
      `${label} could not be read`,
      { evidence_id: reference.evidence_id, expected_kind: expectedKind },
    );
    const content = evidenceContent(record);
    invariant(
      record.evidence_id === reference.evidence_id &&
        record.evidence_hash === reference.evidence_hash &&
        record.kind === expectedKind &&
        reference.kind === expectedKind &&
        sha256(content) === record.evidence_hash,
      "AUDIT_SOURCE_IDENTITY_MISMATCH",
      `${label} identity or content digest is invalid`,
      { evidence_id: reference.evidence_id, expected_kind: expectedKind },
    );
    return record;
  }

  now() {
    return this.clock().toISOString();
  }
}

function createRunPayload(run, evidence, usage) {
  return {
    identity: {
      run_id: run.run_id,
      change_set_id: run.change_set_id,
      work_unit_id: run.work_unit_id,
      operation: run.operation,
      trigger: run.trigger,
      attempt: run.attempt,
    },
    status: run.status,
    terminal:
      evidence?.terminal ?? {
        status: "running",
        outcome_type: null,
        error_code: null,
      },
    outcome: structuredClone(run.outcome ?? null),
    agent_profile: structuredClone(run.agent_profile),
    provider: structuredClone(evidence?.provider ?? null),
    requested_runtime: structuredClone(evidence?.requested ?? null),
    observed_runtime: structuredClone(evidence?.observed ?? null),
    context_projection: structuredClone(
      evidence?.context_projection ?? run.context_projection_identity ?? null,
    ),
    context_evidence: structuredClone(run.context_evidence ?? null),
    repository_harness_selection: summarizeHarnessSelection(
      run.repository_harness_selection ?? null,
    ),
    repository_harness_observation: summarizeHarnessObservation(
      evidence?.repository_harness_observation ??
        run.repository_harness_observation ??
        null,
    ),
    timing: {
      created_at: run.created_at,
      completed_at: run.completed_at,
      run_elapsed_ms: elapsedMilliseconds(run.created_at, run.completed_at),
      provider_started_at: evidence?.timing?.started_at ?? null,
      provider_completed_at: evidence?.timing?.completed_at ?? null,
      provider_duration_ms: evidence?.timing?.duration_ms ?? null,
    },
    usage,
    runtime_evidence:
      evidence === null
        ? null
        : {
            evidence_classification: evidence.evidence_classification,
            raw_artifact_references: boundedRows(
              structuredClone(evidence.raw_artifact_references ?? []),
            ),
            monetary_cost: evidence.monetary_cost ?? null,
          },
  };
}

function summarizeHarnessSelection(selection) {
  if (selection === null) return null;
  const repositories = Array.isArray(selection.repositories)
    ? selection.repositories
    : [];
  return {
    revision: selection.revision ?? null,
    repositories: boundedRows(
      repositories
        .map((repository) => ({
          repository_id: repository.repository_id,
          resolved_base_sha: repository.resolved_base_sha,
          mode: repository.mode,
          provider_family: repository.provider_family,
          workspace_policy_revision:
            repository.workspace_policy_revision ?? null,
          selector_digest: repository.selector_digest ?? null,
          content_digest: repository.content_digest ?? null,
          resolved_path_count: Array.isArray(repository.resolved_relative_paths)
            ? repository.resolved_relative_paths.length
            : 0,
          resolved_path_identity: sha256(
            repository.resolved_relative_paths ?? [],
          ),
          artifact_reference: structuredClone(
            repository.artifact_reference ?? null,
          ),
        }))
        .sort((left, right) =>
          left.repository_id.localeCompare(right.repository_id),
        ),
    ),
  };
}

function summarizeHarnessObservation(observation) {
  if (observation === null) return null;
  const repositories = Array.isArray(observation.repositories)
    ? observation.repositories
    : [];
  return {
    repositories: boundedRows(
      repositories
        .map((repository) => {
          const exact = repository.exact_base_resources ?? [];
          const overlay = repository.frozen_overlay_resources ?? [];
          const discovery = repository.provider_discovery ?? {};
          return {
            repository_id: repository.repository_id,
            exact_base_resource_count: exact.length,
            exact_base_resource_identity: sha256(exact),
            frozen_overlay_resource_count: overlay.length,
            frozen_overlay_resource_identity: sha256(overlay),
            provider_discovery: {
              coverage: discovery.coverage ?? "unknown",
              discovered_count: Array.isArray(discovery.discovered_resources)
                ? discovery.discovered_resources.length
                : 0,
              loaded_count: Array.isArray(discovery.loaded_resources)
                ? discovery.loaded_resources.length
                : 0,
            },
          };
        })
        .sort((left, right) =>
          left.repository_id.localeCompare(right.repository_id),
        ),
    ),
  };
}

function summarizeChangeSetUsage(loadedRuns) {
  const canonical = loadedRuns.map((loaded) => loaded.payload.usage.canonical);
  const totals = Object.fromEntries(
    USAGE_TOKEN_FIELDS.map((field) => [
      field,
      summarizeNullableNumbers(canonical.map((usage) => usage[field])),
    ]),
  );
  return {
    referenced_run_count: canonical.length,
    observed_run_count: totals.total_tokens.known_count,
    unknown_run_count: totals.total_tokens.unknown_count,
    observed_total_tokens: totals.total_tokens.observed_sum,
    token_fields: totals,
    coverage_breakdown: countValues(canonical.map((usage) => usage.coverage)),
    confidence_breakdown: countValues(
      canonical.map((usage) => usage.confidence),
    ),
  };
}

function summarizeChangeSetTiming(state, loadedRuns, validation) {
  const providerDurations = loadedRuns.map(
    (loaded) => loaded.payload.timing.provider_duration_ms,
  );
  const runElapsed = loadedRuns.map(
    (loaded) => loaded.payload.timing.run_elapsed_ms,
  );
  const humanGates = humanGateRows(state);
  return {
    provider_duration_sum: summarizeNullableNumbers(providerDurations),
    run_elapsed_sum: summarizeNullableNumbers(runElapsed),
    validation_duration_sum: validation.payload.duration,
    change_set_wall: {
      started_at: state.created_at ?? null,
      observed_through: state.updated_at ?? null,
      observed_elapsed_ms: elapsedMilliseconds(
        state.created_at,
        state.updated_at,
      ),
      complete: state.phase === "terminal",
    },
    human_gate_duration_sum: summarizeNullableNumbers(
      humanGates.map((gate) => gate.duration_ms),
    ),
  };
}

function summarizeOutcomes(state, loadedRuns, validation) {
  const currentUnits = state.work_units.filter(
    (unit) =>
      unit.plan_revision === state.current_plan_revision &&
      unit.disposition === "current",
  );
  const planningRuns = loadedRuns.filter(
    (loaded) => loaded.payload.identity.operation === "planning",
  );
  const verificationRuns = loadedRuns.filter(
    (loaded) => loaded.payload.identity.operation === "verification",
  );
  const reviewRuns = loadedRuns.filter(
    (loaded) => loaded.payload.identity.operation === "review",
  );
  const feedbackExecutionRuns = loadedRuns.filter(
    (loaded) =>
      loaded.payload.identity.operation === "execution" &&
      loaded.payload.identity.trigger === "feedback",
  );
  return {
    runtime_attempts: countValues(
      loadedRuns.map((loaded) => loaded.payload.terminal.status),
    ),
    planning: countValues(
      planningRuns.map((loaded) =>
        loaded.payload.terminal.status === "completed"
          ? (loaded.payload.terminal.outcome_type ?? "completed_unknown")
          : loaded.payload.terminal.status,
      ),
    ),
    verification: countValues(
      verificationRuns.map((loaded) =>
        loaded.payload.terminal.status === "completed"
          ? (loaded.payload.outcome?.verdict ??
            loaded.payload.terminal.outcome_type ??
            "completed_unknown")
          : loaded.payload.terminal.status,
      ),
    ),
    bundle_review: countValues(
      reviewRuns.map((loaded) =>
        loaded.payload.terminal.status === "completed"
          ? (loaded.payload.outcome?.disposition ??
            loaded.payload.terminal.outcome_type ??
            "completed_unknown")
          : loaded.payload.terminal.status,
      ),
    ),
    // 反馈执行单列展示但仍包含在 runtime_attempts 与总 usage 中，避免重复计费。
    feedback_execution: countValues(
      feedbackExecutionRuns.map((loaded) =>
        loaded.payload.terminal.status === "completed"
          ? (loaded.payload.terminal.outcome_type ?? "completed_unknown")
          : loaded.payload.terminal.status,
      ),
    ),
    work_units: countValues(currentUnits.map((unit) => unit.phase)),
    work_unit_history: countValues(
      state.work_units.map((unit) => `${unit.disposition}/${unit.phase}`),
    ),
    validation: validation.payload.outcomes,
    bundles: countValues(
      state.bundles.map((bundle) =>
        state.decisions.some(
          (decision) =>
            decision.type === "bundle_review" &&
            decision.bundle_revision === bundle.revision &&
            decision.bundle_hash === bundle.bundle_hash,
        )
          ? "reviewed"
          : "assembled",
      ),
    ),
    human_review: countValues(
      state.decisions
        .filter((decision) => decision.type === "bundle_review")
        .map((decision) => decision.decision),
    ),
    delivery: summarizeDelivery(state),
  };
}

function summarizeDelivery(state) {
  // 审计只投影当前 Bundle 的有界状态计数；完整 GitHub 观察仍通过不可变证据链读取。
  const bundleId = state.bundles.at(-1)?.bundle_id ?? null;
  const requests = (state.delivery_requests ?? []).filter(
    (request) => request.bundle_id === bundleId,
  );
  if (requests.length === 0) {
    return { unavailable: 1, reason: "not_started" };
  }
  const states = countValues(requests.map((request) => request.state));
  return {
    unavailable: 0,
    current_bundle_id: bundleId,
    request_count: requests.length,
    states,
    merged_count: states.merged ?? 0,
    complete: requests.every((request) => request.state === "merged"),
    partial_merge:
      requests.some((request) => request.state === "merged") &&
      requests.some((request) => request.state !== "merged"),
  };
}

function summarizeBundles(state) {
  const rows = [...state.bundles]
    .sort((left, right) => left.revision - right.revision)
    .map((bundle) => ({
      bundle_id: bundle.bundle_id,
      revision: bundle.revision,
      bundle_hash: bundle.bundle_hash,
      plan_revision: bundle.plan_revision,
      created_at: bundle.created_at,
      candidate_count: bundle.candidates.length,
      human_decision:
        state.decisions.find(
          (decision) =>
            decision.type === "bundle_review" &&
            decision.bundle_revision === bundle.revision &&
            decision.bundle_hash === bundle.bundle_hash,
        )?.decision ?? null,
      quality_review: bundleReviewSummary(state, bundle),
    }));
  return boundedRows(rows);
}

// 审计视图连接 assessment 与通用 Run；用量和耗时仍只从不可变 Run evidence 推导。
function summarizeBundleReviews(state, loadedRuns) {
  const rows = (state.bundle_review_assessments ?? [])
    .map((assessment) => ({
      assessment_id: assessment.assessment_id,
      run_id: assessment.run_id,
      plan_revision: assessment.plan_revision,
      bundle_id: assessment.bundle_id,
      bundle_revision: assessment.bundle_revision,
      bundle_hash: assessment.bundle_hash,
      subject_digest: assessment.subject_digest,
      disposition: assessment.disposition,
      summary: assessment.summary,
      findings: structuredClone(assessment.findings),
      blocking_findings: assessment.findings.filter(
        (finding) => finding.severity === "blocking",
      ).length,
      advisory_findings: assessment.findings.filter(
        (finding) => finding.severity === "advisory",
      ).length,
      agent_profile_id: assessment.agent_profile.profile_id,
      agent_profile_revision: assessment.agent_profile.revision,
      assessment_artifact:
        loadedRuns.find(
          (loaded) =>
            loaded.payload.identity.run_id === assessment.run_id,
        )?.payload.outcome?.assessment_artifact ?? null,
      created_at: assessment.created_at,
      current:
        assessment.assessment_id ===
        state.current_bundle_review_assessment_id,
    }))
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  return boundedRows(rows);
}

function bundleReviewSummary(state, bundle) {
  const assessment = (state.bundle_review_assessments ?? []).find(
    (item) =>
      item.assessment_id === state.current_bundle_review_assessment_id &&
      item.bundle_id === bundle.bundle_id,
  );
  return assessment
    ? {
        assessment_id: assessment.assessment_id,
        disposition: assessment.disposition,
        run_id: assessment.run_id,
      }
    : null;
}

function summarizeHumanReview(state) {
  const rows = state.decisions
    .filter((decision) => decision.type === "bundle_review")
    .sort((left, right) => left.decided_at.localeCompare(right.decided_at))
    .map((decision) => ({
      decision_id: decision.decision_id,
      bundle_revision: decision.bundle_revision,
      bundle_hash: decision.bundle_hash,
      decision: decision.decision,
      actor: decision.actor,
      decided_at: decision.decided_at,
      duration_ms:
        humanGateRows(state).find(
          (gate) => gate.decision_id === decision.decision_id,
        )?.duration_ms ?? null,
    }));
  return boundedRows(rows);
}

function humanGateRows(state) {
  return state.decisions
    .filter((decision) => decision.type === "bundle_review")
    .map((decision) => {
      const bundle = state.bundles.find(
        (candidate) =>
          candidate.revision === decision.bundle_revision &&
          candidate.bundle_hash === decision.bundle_hash,
      );
      return {
        decision_id: decision.decision_id,
        duration_ms: elapsedMilliseconds(bundle?.created_at, decision.decided_at),
      };
    });
}

function runDetailRow(payload) {
  return {
    identity: payload.identity,
    status: payload.status,
    change_set_reference: payload.change_set_reference,
    terminal: payload.terminal,
    timing: payload.timing,
    canonical_usage: payload.usage.canonical,
    agent_profile: payload.agent_profile,
    context_projection: payload.context_projection,
    repository_harness_selection: payload.repository_harness_selection,
    diagnostics: payload.usage.diagnostics,
  };
}

function collectValidationReferences(state) {
  const requested = [];
  for (const attempt of state.validation_attempts ?? []) {
    requested.push({
      reference: attempt.evidence,
      expected_kind: attempt.kind,
      label: `Validation attempt ${attempt.validation_attempt_id}`,
      attempt,
      candidate: null,
      bundle: null,
    });
  }
  for (const candidate of state.candidates ?? []) {
    if (!candidate.repository_evidence) continue;
    requested.push({
      reference: candidate.repository_evidence,
      expected_kind: "repository_validation",
      label: `Repository validation for ${candidate.candidate_id}`,
      candidate,
      attempt: null,
    });
  }
  for (const bundle of state.bundles ?? []) {
    for (const candidate of bundle.candidates ?? []) {
      requested.push({
        reference: candidate.repository_evidence,
        expected_kind: "repository_validation",
        label: `Bundle repository validation for ${candidate.candidate_id}`,
        candidate,
        attempt: null,
      });
    }
    requested.push({
      reference: bundle.combined_validation_evidence,
      expected_kind: "combined_validation",
      label: `Combined validation for ${bundle.bundle_id}`,
      candidate: null,
      bundle,
      attempt: null,
    });
  }
  return requested;
}

function deduplicateEvidence(records) {
  const unique = new Map();
  for (const item of records) {
    const existing = unique.get(item.record.evidence_id);
    invariant(
      existing === undefined ||
        existing.record.evidence_hash === item.record.evidence_hash,
      "AUDIT_SOURCE_IDENTITY_MISMATCH",
      "One evidence id resolved to different immutable content",
      { evidence_id: item.record.evidence_id },
    );
    if (existing === undefined) unique.set(item.record.evidence_id, item);
  }
  return [...unique.values()].sort((left, right) =>
    left.record.evidence_id.localeCompare(right.record.evidence_id),
  );
}

function validationRow(record, attempt = null) {
  const command = record.payload?.command ?? null;
  const postflight = record.payload?.postflight ?? null;
  invariant(
    command?.duration_ms === undefined ||
      command.duration_ms === null ||
      (Number.isSafeInteger(command.duration_ms) && command.duration_ms >= 0),
    "AUDIT_REQUIRED_REFERENCE_INVALID",
    "Validation duration must be null or a non-negative integer",
    { evidence_id: record.evidence_id },
  );
  const status =
    command === null
      ? "unavailable"
      : command.exit_code === 0 &&
          command.timed_out === false &&
          command.output_overflow === false &&
          postflight?.status !== "failed"
        ? "passed"
        : "failed";
  return {
    evidence_id: record.evidence_id,
    evidence_hash: record.evidence_hash,
    kind: record.kind,
    subject: structuredClone(record.subject),
    status,
    duration_ms:
      Number.isSafeInteger(attempt?.duration_ms) && attempt.duration_ms >= 0
        ? attempt.duration_ms
        : Number.isSafeInteger(command?.duration_ms) && command.duration_ms >= 0
        ? command.duration_ms
        : null,
    attempt:
      attempt === null
        ? null
        : {
            validation_attempt_id: attempt.validation_attempt_id,
            attempt: attempt.attempt,
            recorded_status: attempt.status,
            error_code: attempt.error_code,
            check_identity: structuredClone(attempt.check_identity ?? null),
            requested_budget: structuredClone(
              attempt.requested_budget ?? null,
            ),
            effective_budget: structuredClone(
              attempt.effective_budget ?? null,
            ),
            budget_source: attempt.budget_source ?? null,
            budget_limit: structuredClone(attempt.budget_limit ?? null),
            environment_identity: structuredClone(
              attempt.environment_identity ?? null,
            ),
            started_at: attempt.started_at ?? null,
            completed_at: attempt.completed_at ?? attempt.created_at ?? null,
            duration_ms: attempt.duration_ms ?? null,
          },
  };
}

function validateRepositoryValidationSubject(record, candidate) {
  invariant(
    record.subject?.repository_id === candidate.repository_id &&
      record.subject?.base_sha === candidate.base_sha &&
      record.subject?.candidate_sha === candidate.candidate_sha &&
      record.subject?.target_ref === candidate.target_ref,
    "AUDIT_SOURCE_IDENTITY_MISMATCH",
    "Repository validation evidence does not bind the referenced Candidate",
    { evidence_id: record.evidence_id, candidate_id: candidate.candidate_id },
  );
}

function validateValidationAttemptSubject(record, attempt, state) {
  const identity = {
    kind: attempt.kind,
    subject_id: attempt.subject_id,
    attempt: attempt.attempt,
    evidence_id: attempt.evidence.evidence_id,
  };
  if (attempt.check_identity !== undefined && attempt.check_identity !== null) {
    identity.check_identity_hash = attempt.check_identity.check_identity_hash;
    identity.effective_budget = attempt.effective_budget;
  }
  invariant(
    stableId("validation-attempt", identity) === attempt.validation_attempt_id,
    "AUDIT_SOURCE_IDENTITY_MISMATCH",
    "Validation attempt identity does not match its immutable fields",
    { validation_attempt_id: attempt.validation_attempt_id },
  );
  if (
    attempt.kind === "repository_validation" ||
    attempt.kind === "verification_check"
  ) {
    const checkpoint = (state.candidate_checkpoints ?? []).find(
      (item) => item.checkpoint_id === attempt.subject_id,
    );
    invariant(
      checkpoint !== undefined,
      "AUDIT_REQUIRED_REFERENCE_INVALID",
      "Repository-scoped validation attempt does not bind an available checkpoint",
      { validation_attempt_id: attempt.validation_attempt_id },
    );
    validateRepositoryValidationSubject(record, checkpoint);
  } else {
    invariant(
      record.subject?.validation_subject_hash === attempt.subject_id,
      "AUDIT_SOURCE_IDENTITY_MISMATCH",
      "Combined validation attempt does not bind its evidence subject",
      { validation_attempt_id: attempt.validation_attempt_id },
    );
  }
  if (attempt.check_identity !== undefined && attempt.check_identity !== null) {
    invariant(
      sha256(attempt.check_identity) === sha256(record.payload?.check_identity) &&
        sha256({
          requested: attempt.requested_budget,
          effective: attempt.effective_budget,
          source: attempt.budget_source,
          limit: attempt.budget_limit,
        }) === sha256(record.payload?.attempt_budget) &&
        sha256(attempt.environment_identity) ===
          sha256(record.payload?.environment_identity),
      "AUDIT_SOURCE_IDENTITY_MISMATCH",
      "Validation attempt metadata does not match immutable evidence",
      { validation_attempt_id: attempt.validation_attempt_id },
    );
  }
}

function validateCombinedValidationSubject(record, state, bundle) {
  const plan = state.plans.find(
    (candidate) => candidate.revision === bundle.plan_revision,
  );
  invariant(
    plan !== undefined,
    "AUDIT_REQUIRED_REFERENCE_INVALID",
    "CandidateBundle refers to an unavailable plan revision",
    { bundle_id: bundle.bundle_id, plan_revision: bundle.plan_revision },
  );
  const expected = createValidationSubject(state, plan, bundle.candidates);
  const evidenceSubjectHash = record.subject?.validation_subject_hash;
  invariant(
    expected.validation_subject_hash === evidenceSubjectHash &&
      record.payload?.manifest?.validation_subject_hash ===
        evidenceSubjectHash &&
      record.payload?.manifest?.change_set_id === state.change_set_id &&
      record.payload?.manifest?.plan_revision === bundle.plan_revision,
    "AUDIT_SOURCE_IDENTITY_MISMATCH",
    "Combined validation evidence does not bind the CandidateBundle subject",
    { evidence_id: record.evidence_id, bundle_id: bundle.bundle_id },
  );
}

function validateRuntimeEvidence(run, record) {
  const subject = record.subject ?? {};
  const payload = record.payload ?? {};
  invariant(
    subject.run_id === run.run_id &&
      subject.attempt === run.attempt &&
      subject.operation === run.operation &&
      subject.change_set_id === run.change_set_id &&
      subject.work_unit_id === run.work_unit_id &&
      payload.run_id === run.run_id &&
      payload.attempt === run.attempt &&
      payload.operation === run.operation &&
      payload.change_set_id === run.change_set_id &&
      payload.work_unit_id === run.work_unit_id &&
      payload.terminal &&
      typeof payload.terminal === "object" &&
      payload.timing &&
      typeof payload.timing === "object" &&
      typeof payload.timing.started_at === "string" &&
      Number.isFinite(Date.parse(payload.timing.started_at)) &&
      typeof payload.timing.completed_at === "string" &&
      Number.isFinite(Date.parse(payload.timing.completed_at)) &&
      Number.isSafeInteger(payload.timing.duration_ms) &&
      payload.timing.duration_ms >= 0 &&
      ["completed", "failed", "cancelled", "interrupted"].includes(
        payload.terminal.status,
      ) &&
      Array.isArray(payload.usage_observations),
    "AUDIT_SOURCE_IDENTITY_MISMATCH",
    "Runtime evidence does not bind the referenced Run",
    { run_id: run.run_id, evidence_id: record.evidence_id },
  );
}

function validateRunAuditSource(run) {
  invariant(
    typeof run.change_set_id === "string" &&
      (run.work_unit_id === null || typeof run.work_unit_id === "string") &&
      ["planning", "execution", "verification", "supervision", "review"].includes(
        run.operation,
      ) &&
      Number.isSafeInteger(run.attempt) &&
      run.attempt >= 1 &&
      typeof run.status === "string" &&
      run.agent_profile &&
      typeof run.agent_profile === "object" &&
      typeof run.created_at === "string" &&
      Number.isFinite(Date.parse(run.created_at)) &&
      (run.status === "running" ||
        (typeof run.completed_at === "string" &&
          Number.isFinite(Date.parse(run.completed_at)))),
    "AUDIT_REQUIRED_REFERENCE_INVALID",
    "Run audit source is malformed",
    { run_id: run.run_id },
  );
}

function validateChangeSetAuditSource(state, changeSetId) {
  invariant(
    state?.change_set_id === changeSetId &&
      Array.isArray(state.run_references) &&
      Array.isArray(state.plans) &&
      Array.isArray(state.work_units) &&
      Array.isArray(state.candidates) &&
      Array.isArray(state.bundles) &&
      Array.isArray(state.bundle_review_assessments) &&
      Array.isArray(state.decisions) &&
      typeof state.created_at === "string" &&
      Number.isFinite(Date.parse(state.created_at)) &&
      typeof state.updated_at === "string" &&
      Number.isFinite(Date.parse(state.updated_at)),
    "AUDIT_SOURCE_IDENTITY_MISMATCH",
    "ChangeSet audit source does not match the requested identity",
    { change_set_id: changeSetId },
  );
  for (const bundle of state.bundles) validateBundleIdentity(bundle);
  for (const decision of state.decisions.filter(
    (candidate) => candidate.type === "bundle_review",
  )) {
    invariant(
      state.bundles.some(
        (bundle) =>
          bundle.revision === decision.bundle_revision &&
          bundle.bundle_hash === decision.bundle_hash,
      ),
      "AUDIT_SOURCE_IDENTITY_MISMATCH",
      "Human review does not bind an exact CandidateBundle",
      { decision_id: decision.decision_id },
    );
  }
  for (const assessment of state.bundle_review_assessments) {
    const bundle = state.bundles.find(
      (candidate) => candidate.bundle_id === assessment.bundle_id,
    );
    const plan = state.plans.find(
      (candidate) => candidate.revision === assessment.plan_revision,
    );
    invariant(
      bundleReviewAssessmentMatches(assessment, bundle, plan) &&
        state.run_references.some(
          (reference) =>
            reference.run_id === assessment.run_id &&
            reference.operation === "review",
        ),
      "AUDIT_SOURCE_IDENTITY_MISMATCH",
      "Bundle review assessment does not bind its exact Bundle and Review Run",
      { assessment_id: assessment.assessment_id },
    );
  }
  invariant(
    state.current_bundle_review_assessment_id === null ||
      state.bundle_review_assessments.some(
        (assessment) =>
          assessment.assessment_id ===
          state.current_bundle_review_assessment_id,
      ),
    "AUDIT_SOURCE_IDENTITY_MISMATCH",
    "Current Bundle review assessment reference is invalid",
  );
}

function validateBundleIdentity(bundle) {
  invariant(
    bundle && typeof bundle === "object" && Array.isArray(bundle.candidates),
    "AUDIT_REQUIRED_REFERENCE_INVALID",
    "CandidateBundle audit source is malformed",
  );
  const {
    bundle_id: bundleId,
    bundle_hash: bundleHash,
    created_at: _createdAt,
    ...identity
  } = bundle;
  invariant(
    sha256(identity) === bundleHash &&
      stableId("bundle", { revision: bundle.revision, bundleHash }) === bundleId,
    "AUDIT_SOURCE_IDENTITY_MISMATCH",
    "CandidateBundle identity or content digest is invalid",
    { bundle_id: bundleId },
  );
}

function validateRunReference(reference, changeSetId, seenRunIds) {
  invariant(
    reference && typeof reference === "object" && typeof reference.run_id === "string",
    "AUDIT_REQUIRED_REFERENCE_INVALID",
    "ChangeSet contains an invalid Run reference",
    { change_set_id: changeSetId },
  );
  invariant(
    !seenRunIds.has(reference.run_id),
    "AUDIT_REQUIRED_REFERENCE_INVALID",
    "ChangeSet contains a duplicate Run reference",
    { change_set_id: changeSetId, run_id: reference.run_id },
  );
  seenRunIds.add(reference.run_id);
}

function validateRunAgainstReference(run, reference) {
  invariant(
    run.operation === reference.operation &&
      (reference.work_unit_id === undefined ||
        run.work_unit_id === reference.work_unit_id) &&
      (reference.attempt === undefined || run.attempt === reference.attempt),
    "AUDIT_SOURCE_IDENTITY_MISMATCH",
    "Run record does not match its ChangeSet reference",
    { run_id: run.run_id },
  );
}

function validateEvidenceReferenceShape(reference, expectedKind, label) {
  invariant(
    reference &&
      typeof reference === "object" &&
      typeof reference.evidence_id === "string" &&
      typeof reference.evidence_hash === "string" &&
      reference.kind === expectedKind,
    "AUDIT_REQUIRED_REFERENCE_INVALID",
    `${label} has an invalid evidence reference`,
    { expected_kind: expectedKind },
  );
}

function evidenceContent(record) {
  invariant(
    record && typeof record === "object",
    "AUDIT_REQUIRED_REFERENCE_INVALID",
    "Evidence record must be an object",
  );
  return {
    schema_version: record.schema_version,
    kind: record.kind,
    subject: record.subject,
    payload: record.payload,
    created_at: record.created_at,
  };
}

function evidenceIdentity(record) {
  return {
    evidence_id: record.evidence_id,
    evidence_hash: record.evidence_hash,
    kind: record.kind,
  };
}

function withSourceDigest(source) {
  return { ...source, source_digest: sha256(source) };
}

function summarizeNullableNumbers(values) {
  const known = values.filter(
    (value) => Number.isSafeInteger(value) && value >= 0,
  );
  let observedSum = null;
  if (known.length > 0) {
    observedSum = 0;
    for (const value of known) {
      invariant(
        Number.isSafeInteger(observedSum + value),
        "AUDIT_REQUIRED_REFERENCE_INVALID",
        "Audit numeric sum exceeds the safe integer boundary",
      );
      observedSum += value;
    }
  }
  return {
    observed_sum: observedSum,
    known_count: known.length,
    unknown_count: values.length - known.length,
  };
}

function countValues(values) {
  const counts = {};
  for (const value of values) {
    const key = value ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function boundedRows(rows) {
  return {
    referenced_count: rows.length,
    shown_count: Math.min(rows.length, MAX_BOUNDED_ROWS),
    omitted_count: Math.max(0, rows.length - MAX_BOUNDED_ROWS),
    rows: rows.slice(0, MAX_BOUNDED_ROWS),
  };
}

function summarizeDiagnostics(diagnostics) {
  return {
    ...boundedRows(diagnostics),
    code_counts: countValues(diagnostics.map((diagnostic) => diagnostic.code)),
  };
}

function normalizePageQuery(query) {
  invariant(
    query && typeof query === "object" && !Array.isArray(query),
    "INVALID_AUDIT_QUERY",
    "Audit page query must be an object",
  );
  const allowed = new Set(["detail_page", "page_size"]);
  invariant(
    Object.keys(query).every((key) => allowed.has(key)),
    "INVALID_AUDIT_QUERY",
    "Audit page query contains an unsupported field",
    { fields: Object.keys(query).sort() },
  );
  const detailPage = query.detail_page ?? 1;
  const pageSize = query.page_size ?? MAX_AUDIT_RUN_ROWS;
  invariant(
    Number.isSafeInteger(detailPage) && detailPage >= 1,
    "INVALID_AUDIT_QUERY",
    "detail_page must be a positive integer",
    { detail_page: detailPage },
  );
  invariant(
    Number.isSafeInteger(pageSize) &&
      pageSize >= 1 &&
      pageSize <= MAX_AUDIT_RUN_ROWS,
    "INVALID_AUDIT_QUERY",
    `page_size must be between 1 and ${MAX_AUDIT_RUN_ROWS}`,
    { page_size: pageSize },
  );
  return { detailPage, pageSize };
}

function localizeDiagnostics(diagnostics, locale) {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    message: diagnosticMessage(diagnostic.code, { locale }),
    locale,
  }));
}

function compareLoadedRuns(left, right) {
  return (
    left.payload.timing.created_at.localeCompare(right.payload.timing.created_at) ||
    left.payload.identity.attempt - right.payload.identity.attempt ||
    left.payload.identity.run_id.localeCompare(right.payload.identity.run_id)
  );
}

function requireReader(store, method, label) {
  invariant(
    store && typeof store[method] === "function",
    "INVALID_AUDIT_QUERY",
    `${label} must provide ${method}()` ,
  );
}

async function readRequired(reader, code, message, details) {
  try {
    const value = await reader();
    invariant(value !== null && value !== undefined, code, message, details);
    return value;
  } catch (error) {
    if (error instanceof ChangeFleetError) throw error;
    const wrapped = new ChangeFleetError(code, message, {
      ...details,
      cause_code: error.code ?? "UNEXPECTED_ERROR",
    });
    wrapped.cause = error;
    throw wrapped;
  }
}
