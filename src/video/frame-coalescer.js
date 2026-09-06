export class LatestFrameCoalescer {
  constructor({ apply, cancelFrame, requestFrame } = {}) {
    if (typeof apply !== 'function') throw new TypeError('A frame update callback is required.');
    if (typeof requestFrame !== 'function')
      throw new TypeError('A frame scheduler callback is required.');
    if (typeof cancelFrame !== 'function')
      throw new TypeError('A frame cancellation callback is required.');

    this._apply = apply;
    this._cancelFrame = cancelFrame;
    this._requestFrame = requestFrame;
    this._frameId = null;
    this._hasPendingValue = false;
    this._pendingValue = undefined;
  }

  queue(value) {
    this._pendingValue = value;
    this._hasPendingValue = true;
    if (this._frameId !== null) return;
    this._frameId = this._requestFrame(() => this._run());
  }

  flush() {
    if (this._frameId !== null) {
      this._cancelFrame(this._frameId);
      this._frameId = null;
    }
    this._runPending();
  }

  cancel() {
    if (this._frameId !== null) this._cancelFrame(this._frameId);
    this._frameId = null;
    this._hasPendingValue = false;
    this._pendingValue = undefined;
  }

  get scheduled() {
    return this._frameId !== null;
  }

  _run() {
    this._frameId = null;
    this._runPending();
  }

  _runPending() {
    if (!this._hasPendingValue) return;
    const value = this._pendingValue;
    this._hasPendingValue = false;
    this._pendingValue = undefined;
    this._apply(value);
  }
}
