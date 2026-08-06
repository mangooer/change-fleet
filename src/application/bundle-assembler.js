import { createCandidateBundle } from "../domain/model.js";

// BundleAssembler 只冻结并持久化精确审查主体，不改变 ChangeSet 阶段或代替人类决定。
export class BundleAssembler {
  constructor({ controlStore, now }) {
    this.controlStore = controlStore;
    this.now = now;
  }

  async assemble({ changeSet, plan, candidates, combinedEvidence }) {
    const bundle = createCandidateBundle({
      changeSet,
      plan,
      candidates,
      combinedEvidence,
      createdAt: this.now(),
    });
    await this.controlStore.writeBundle(bundle);
    return bundle;
  }
}
