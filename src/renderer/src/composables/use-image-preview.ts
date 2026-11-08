import { computed, ref, watch } from 'vue'

/** 图片适应视口，放大后以受限平移代替滚动容器。 */
export function useImagePreview() {
  const viewport = ref<HTMLElement | null>(null)
  const size = ref({ width: 0, height: 0 })
  const natural = ref({ width: 0, height: 0 })
  const zoom = ref(100)
  const pan = ref({ x: 0, y: 0 })
  const drag = ref<{ id: number; x: number; y: number; panX: number; panY: number } | null>(null)
  const fitted = computed(() => {
    if (!natural.value.width || !natural.value.height) return { width: 0, height: 0 }
    const scale = Math.min(
      Math.max(0, size.value.width - 32) / natural.value.width,
      Math.max(0, size.value.height - 32) / natural.value.height
    )
    return { width: natural.value.width * scale, height: natural.value.height * scale }
  })
  const bounds = computed(() => ({
    x: Math.max(0, ((fitted.value.width * zoom.value) / 100 - size.value.width) / 2),
    y: Math.max(0, ((fitted.value.height * zoom.value) / 100 - size.value.height) / 2)
  }))
  const canPan = computed(() => bounds.value.x > 0 || bounds.value.y > 0)
  const imageStyle = computed(() => ({
    width: `${fitted.value.width}px`,
    height: `${fitted.value.height}px`,
    transform: `translate(-50%, -50%) translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value / 100})`
  }))

  function clampPan(): void {
    pan.value = {
      x: Math.max(-bounds.value.x, Math.min(bounds.value.x, pan.value.x)),
      y: Math.max(-bounds.value.y, Math.min(bounds.value.y, pan.value.y))
    }
  }
  function endDrag(event?: PointerEvent): void {
    if (event && drag.value && drag.value.id !== event.pointerId) return
    if (drag.value && viewport.value?.hasPointerCapture(drag.value.id))
      viewport.value.releasePointerCapture(drag.value.id)
    drag.value = null
  }
  function fit(): void {
    endDrag()
    zoom.value = 100
    pan.value = { x: 0, y: 0 }
  }
  function loaded(event: Event): void {
    const image = event.target as HTMLImageElement
    natural.value = { width: image.naturalWidth, height: image.naturalHeight }
  }
  function start(event: PointerEvent): void {
    if (!canPan.value || event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    viewport.value?.setPointerCapture(event.pointerId)
    drag.value = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.value.x,
      panY: pan.value.y
    }
  }
  function move(event: PointerEvent): void {
    if (!drag.value || drag.value.id !== event.pointerId) return
    pan.value = {
      x: drag.value.panX + event.clientX - drag.value.x,
      y: drag.value.panY + event.clientY - drag.value.y
    }
    clampPan()
  }
  function wheel(event: WheelEvent): void {
    if (!natural.value.width || !viewport.value || event.deltaY === 0) return
    const next = Math.max(50, Math.min(300, zoom.value + (event.deltaY < 0 ? 10 : -10)))
    const ratio = next / zoom.value,
      rect = viewport.value.getBoundingClientRect()
    const x = event.clientX - rect.left - rect.width / 2,
      y = event.clientY - rect.top - rect.height / 2
    pan.value = { x: x + (pan.value.x - x) * ratio, y: y + (pan.value.y - y) * ratio }
    zoom.value = next
    clampPan()
  }
  function keyboard(event: KeyboardEvent): void {
    const offset = {
      ArrowLeft: [32, 0],
      ArrowRight: [-32, 0],
      ArrowUp: [0, 32],
      ArrowDown: [0, -32]
    }[event.key]
    if (!offset || !canPan.value) return
    event.preventDefault()
    pan.value = { x: pan.value.x + offset[0]!, y: pan.value.y + offset[1]! }
    clampPan()
  }
  watch(
    viewport,
    (element, _, cleanup) => {
      if (!element) return
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (entry) {
          size.value = { width: entry.contentRect.width, height: entry.contentRect.height }
          clampPan()
        }
      })
      observer.observe(element)
      cleanup(() => observer.disconnect())
    },
    { flush: 'post' }
  )
  watch([zoom, fitted], clampPan)
  return {
    viewport,
    zoom,
    canPan,
    drag,
    imageStyle,
    fit,
    loaded,
    start,
    move,
    endDrag,
    wheel,
    keyboard
  }
}
