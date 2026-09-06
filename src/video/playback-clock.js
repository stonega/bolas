function microseconds(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

export class PlaybackClock {
  constructor() {
    this.reset();
  }

  reset() {
    this._anchorFrameTimeUs = 0;
    this._anchorTimestampUs = 0;
    this._lastReportedTimestampUs = 0;
    this._lastTimestampUs = 0;
    this._running = false;
  }

  sample({
    frameTimeUs = 0,
    mediaTimestampUs = 0,
    playing = false,
    requestedTimestampUs = null,
    seeking = false,
  } = {}) {
    const frameTime = microseconds(frameTimeUs);
    const reportedTimestamp = microseconds(mediaTimestampUs);
    const hasRequestedTimestamp =
      requestedTimestampUs !== null &&
      requestedTimestampUs !== undefined &&
      Number.isFinite(Number(requestedTimestampUs));
    const requestedTimestamp = hasRequestedTimestamp ? microseconds(requestedTimestampUs) : null;
    const sourceTimestamp =
      seeking && requestedTimestamp !== null ? requestedTimestamp : reportedTimestamp;

    if (!playing) {
      this._running = false;
      this._anchorFrameTimeUs = frameTime;
      this._anchorTimestampUs = sourceTimestamp;
      this._lastReportedTimestampUs = sourceTimestamp;
      this._lastTimestampUs = sourceTimestamp;
      return sourceTimestamp;
    }

    if (!this._running) {
      this._running = true;
      this._anchorFrameTimeUs = frameTime;
      this._anchorTimestampUs = sourceTimestamp;
      this._lastReportedTimestampUs = sourceTimestamp;
      this._lastTimestampUs = sourceTimestamp;
      return sourceTimestamp;
    }

    const elapsedUs = Math.max(0, frameTime - this._anchorFrameTimeUs);
    const estimatedTimestamp = this._anchorTimestampUs + elapsedUs;
    if (sourceTimestamp !== this._lastReportedTimestampUs) {
      this._anchorFrameTimeUs = frameTime;
      this._anchorTimestampUs = Math.max(estimatedTimestamp, sourceTimestamp);
      this._lastReportedTimestampUs = sourceTimestamp;
    }

    const timestamp = this._anchorTimestampUs + Math.max(0, frameTime - this._anchorFrameTimeUs);
    this._lastTimestampUs = Math.max(this._lastTimestampUs, Math.round(timestamp));
    return this._lastTimestampUs;
  }
}
