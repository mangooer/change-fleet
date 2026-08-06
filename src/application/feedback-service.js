import {
  appendFeedbackRecord,
  clearCurrentFeedback,
  currentFeedbackContent,
  currentFeedbackRecord,
} from "../domain/feedback.js";
import { invariant } from "../domain/errors.js";

// FeedbackService 只管理不可变反馈事实及当前指针，不负责替 Agent 判断反馈是否正确。
export class FeedbackService {
  constructor({ idFactory, clock }) {
    invariant(
      typeof idFactory === "function" && typeof clock === "function",
      "INVALID_FEEDBACK",
      "FeedbackService requires id and clock providers",
    );
    this.idFactory = idFactory;
    this.clock = clock;
  }

  record(changeSet, { source, target, content, feedbackId = null, createdAt = null }) {
    return appendFeedbackRecord(changeSet, {
      feedbackId: feedbackId ?? this.idFactory("feedback"),
      source,
      target,
      content,
      createdAt: createdAt ?? this.clock().toISOString(),
    });
  }

  current(changeSet) {
    return currentFeedbackRecord(changeSet);
  }

  currentContent(changeSet) {
    return currentFeedbackContent(changeSet);
  }

  clear(changeSet) {
    clearCurrentFeedback(changeSet);
  }
}
