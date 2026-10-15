/**
 * Basketball-Reference headshots are cut out on plain white. Flood-fill the
 * white that touches the top and side edges, feather the edge pixels, and
 * leave interior whites (eyes, jersey trim) alone. Returns the cleared share.
 */
export function removeWhiteBackground(pixels: Uint8ClampedArray, width: number, height: number): number {
  const size = width * height;
  const background = new Uint8Array(size);
  const queue = new Int32Array(size);
  let head = 0, tail = 0;
  const whiteish = (point: number, floor: number) => {
    const i = point * 4, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const low = Math.min(r, g, b);
    return low >= floor && Math.max(r, g, b) - low <= 24;
  };
  // The lower band usually holds the jersey; only near-pure white spreads there.
  const lowerBand = Math.floor(height * 0.82);
  const floorAt = (y: number) => y >= lowerBand ? 246 : 232;
  const visit = (x: number, y: number) => {
    const point = y * width + x;
    if (!background[point] && whiteish(point, floorAt(y))) { background[point] = 1; queue[tail++] = point; }
  };
  for (let x = 0; x < width; x++) visit(x, 0);
  for (let y = 0; y < height; y++) { visit(0, y); visit(width - 1, y); }
  while (head < tail) {
    const point = queue[head++], x = point % width, y = (point - x) / width;
    if (x > 0) visit(x - 1, y);
    if (x < width - 1) visit(x + 1, y);
    if (y > 0) visit(x, y - 1);
    if (y < height - 1) visit(x, y + 1);
  }
  let cleared = 0;
  for (let point = 0; point < size; point++) {
    const i = point * 4;
    if (background[point]) { pixels[i + 3] = 0; cleared++; continue; }
    const x = point % width, y = (point - x) / width;
    const edge = (x > 0 && background[point - 1]) || (x < width - 1 && background[point + 1]) || (y > 0 && background[point - width]) || (y < height - 1 && background[point + width]);
    if (!edge) continue;
    const low = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (low <= 170) continue;
    // Anti-aliased rim: treat brightness as white coverage and un-blend it.
    const alpha = Math.max(0, Math.min(1, (255 - low) / 85));
    pixels[i + 3] = Math.round(alpha * 255);
    if (alpha > 0) for (let channel = 0; channel < 3; channel++) pixels[i + channel] = Math.max(0, Math.min(255, Math.round((pixels[i + channel] - (1 - alpha) * 255) / alpha)));
  }
  return cleared / size;
}

export interface PhotoResult { url: string; cutout: boolean }
const cutouts = new Map<string, Promise<PhotoResult>>();
/**
 * Transparent PNG object URL for a white-background headshot. Photos with a
 * real background (older arena shots) come back unchanged with cutout=false.
 * Rejects when the photo is missing.
 */
export function cutoutPhoto(src: string): Promise<PhotoResult> {
  let pending = cutouts.get(src);
  if (!pending) {
    pending = (async () => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.referrerPolicy = 'no-referrer';
      image.src = src;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context || !canvas.width || !canvas.height) throw new Error('Photo unavailable.');
      context.drawImage(image, 0, 0);
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      const share = removeWhiteBackground(frame.data, canvas.width, canvas.height);
      // Almost nothing cleared: a real photo background. Almost everything: not a cutout.
      if (share < 0.04 || share > 0.85) return { url: src, cutout: false };
      context.putImageData(frame, 0, 0);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Photo unavailable.');
      return { url: URL.createObjectURL(blob), cutout: true };
    })();
    // Failures stay cached for the session so a missing photo is requested once.
    pending.catch(() => {});
    cutouts.set(src, pending);
  }
  return pending;
}
