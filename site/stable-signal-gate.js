export class StableSignalGate {
  constructor(options = {}) {
    this.confirmFrames = Math.max(1, Number(options.confirmFrames) || 5);
    this.stableDistance = Math.max(0, Number(options.stableDistance) || 0.1);
    this.distance = typeof options.distance === "function"
      ? options.distance
      : ((a, b) => Math.abs(Number(a) - Number(b)));
    this.blend = typeof options.blend === "function"
      ? options.blend
      : ((a, b, alpha) => Number(a) * (1 - alpha) + Number(b) * alpha);
    this.blendAlpha = Math.min(1, Math.max(0, Number(options.blendAlpha) || 0.35));
    this.candidate = null;
    this.count = 0;
  }

  resetCandidate() {
    this.candidate = null;
    this.count = 0;
  }

  miss() {
    this.resetCandidate();
  }

  observe(value, requiredFrames = this.confirmFrames) {
    const needed = Math.max(1, Number(requiredFrames) || this.confirmFrames);

    if (this.candidate === null) {
      this.candidate = value;
      this.count = 1;
      return {
        accepted: needed <= 1,
        value: this.candidate,
        count: this.count,
        required: needed
      };
    }

    const distance = this.distance(value, this.candidate);
    if (!Number.isFinite(distance) || distance > this.stableDistance) {
      this.candidate = value;
      this.count = 1;
      return {
        accepted: false,
        value: this.candidate,
        count: this.count,
        required: needed
      };
    }

    this.candidate = this.blend(this.candidate, value, this.blendAlpha);
    this.count += 1;

    return {
      accepted: this.count >= needed,
      value: this.candidate,
      count: this.count,
      required: needed
    };
  }
}
