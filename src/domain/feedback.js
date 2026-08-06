import { invariant } from "./errors.js";

export const FEEDBACK_SOURCES = Object.freeze([
  "human",
  "planning",
  "validation",
  "verification",
  "review",
  "delivery",
]);

const FEEDBACK_SOURCE_SET = new Set(FEEDBACK_SOURCES);

// Feedback 是不可变输入事实；它只引用精确主体，不直接改变任何生命周期字段。
export function createFeedbackRecord({
  feedbackId,
  source,
  target,
  content,
  createdAt,
}) {
  invariant(
    typeof feedbackId === "string" && feedbackId.length > 0,
    "INVALID_REVISION_FEEDBACK",
    "Feedback id is required",
  );
  invariant(
    FEEDBACK_SOURCE_SET.has(source),
    "INVALID_REVISION_FEEDBACK",
    `Feedback source is invalid: ${String(source)}`,
  );
  invariant(
    target && typeof target === "object" && !Array.isArray(target),
    "INVALID_REVISION_FEEDBACK",
    "Feedback target must be one exact subject",
  );
  invariant(
    content &&
      typeof content.summary === "string" &&
      Array.isArray(content.findings),
    "INVALID_REVISION_FEEDBACK",
    "Feedback content must be bounded normalized feedback",
  );
  return {
    feedback_id: feedbackId,
    source,
    target: structuredClone(target),
    content: structuredClone(content),
    created_at: createdAt,
  };
}

export function appendFeedbackRecord(changeSet, input) {
  const record = createFeedbackRecord(input);
  changeSet.feedback_records.push(record);
  changeSet.current_feedback_id = record.feedback_id;
  return record;
}

export function currentFeedbackRecord(changeSet) {
  if (!changeSet.current_feedback_id) return null;
  return (
    changeSet.feedback_records.find(
      (feedback) => feedback.feedback_id === changeSet.current_feedback_id,
    ) ?? null
  );
}

export function currentFeedbackContent(changeSet) {
  return currentFeedbackRecord(changeSet)?.content ?? null;
}

export function clearCurrentFeedback(changeSet) {
  changeSet.current_feedback_id = null;
}
