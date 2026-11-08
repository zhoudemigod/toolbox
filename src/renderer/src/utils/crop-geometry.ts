export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}
export interface ImageSize {
  width: number
  height: number
}
export type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
export function initialCrop(size: ImageSize, ratio: number | null): CropRect {
  const width = ratio ? Math.min(size.width * 0.8, size.height * 0.8 * ratio) : size.width * 0.8
  const height = ratio ? width / ratio : size.height * 0.8
  return { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height }
}

/** 固定对角锚点，任何拖动都不能让选区越过底图或产生负尺寸。 */
export function dragCrop(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  size: ImageSize,
  ratio: number | null
): CropRect {
  if (handle === 'move')
    return {
      ...start,
      x: clamp(start.x + dx, 0, size.width - start.width),
      y: clamp(start.y + dy, 0, size.height - start.height)
    }
  const west = handle.includes('w'),
    north = handle.includes('n')
  const anchorX = west ? start.x + start.width : start.x,
    anchorY = north ? start.y + start.height : start.y
  const sx = west ? -1 : 1,
    sy = north ? -1 : 1
  const maxWidth = west ? anchorX : size.width - anchorX,
    maxHeight = north ? anchorY : size.height - anchorY
  let width = Math.max(1, start.width + dx * sx),
    height = Math.max(1, start.height + dy * sy)
  if (ratio) {
    width = Math.abs(dx) >= Math.abs(dy * ratio) ? width : height * ratio
    width = clamp(
      width,
      Math.min(1, maxWidth, maxHeight * ratio),
      Math.min(maxWidth, maxHeight * ratio)
    )
    height = width / ratio
  } else {
    width = clamp(width, Math.min(1, maxWidth), maxWidth)
    height = clamp(height, Math.min(1, maxHeight), maxHeight)
  }
  return {
    x: west ? anchorX - width : anchorX,
    y: north ? anchorY - height : anchorY,
    width,
    height
  }
}

export function pixelCrop(rect: CropRect, size: ImageSize): CropRect {
  const x = clamp(Math.round(rect.x), 0, size.width - 1),
    y = clamp(Math.round(rect.y), 0, size.height - 1)
  return {
    x,
    y,
    width: clamp(Math.round(rect.width), 1, size.width - x),
    height: clamp(Math.round(rect.height), 1, size.height - y)
  }
}
