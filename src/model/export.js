export const EXPORT_FORMATS = Object.freeze({
  image: Object.freeze([
    {
      id: 'png',
      label: 'PNG',
      extension: 'png',
      mimeType: 'image/png',
      description: 'Lossless image with transparency.',
    },
    {
      id: 'jpeg',
      label: 'JPEG',
      extension: 'jpg',
      mimeType: 'image/jpeg',
      description: 'Smaller image. Transparent areas become white.',
    },
  ]),
  video: Object.freeze([
    {
      id: 'webm',
      label: 'WebM',
      extension: 'webm',
      mimeType: 'video/webm',
      description: 'VP9 video with Opus audio.',
    },
    {
      id: 'mp4',
      label: 'MP4',
      extension: 'mp4',
      mimeType: 'video/mp4',
      description: 'H.264 video with AAC audio.',
    },
  ]),
});

export function exportFormat(kind, id = EXPORT_FORMATS[kind]?.[0]?.id) {
  const format = EXPORT_FORMATS[kind]?.find((item) => item.id === id);
  if (!format) throw new Error(`Unsupported ${kind} export format: ${id}`);
  return format;
}

export function exportPathForFormat(path, format) {
  const value = String(path ?? '');
  const extension = value.match(/\.([^./]+)$/)?.[1]?.toLowerCase();
  if (extension === format.extension || (format.id === 'jpeg' && extension === 'jpeg'))
    return value;
  const stem = /\.(png|jpe?g|webm|mp4)$/i.test(value) ? value.replace(/\.[^./]+$/, '') : value;
  return `${stem}.${format.extension}`;
}

export function videoExportProgress(line, durationUs) {
  if (!line.startsWith('out_time_us=') || !(durationUs > 0)) return null;
  const timeUs = Number(line.slice('out_time_us='.length));
  if (!Number.isFinite(timeUs)) return null;
  // Encoding can finish before the container is closed and the file is committed.
  return Math.min(0.99, Math.max(0, timeUs / durationUs));
}
