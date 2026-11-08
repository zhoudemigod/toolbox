<script setup lang="ts">
import { Button as TButton } from 'tdesign-vue-next'
import { onMounted, onUnmounted, ref } from 'vue'
import { Wrench, HardDrive } from 'lucide-vue-next'
import brandLogo from '../assets/logo.png'

defineProps<{ version: string }>()
const emit = defineEmits<{ home: [] }>()
const rail = ref<HTMLElement | null>(null)
const versionVisible = ref(false)
const menuNameVisible = ref(false)

function home(): void {
  versionVisible.value = false
  menuNameVisible.value = false
  emit('home')
}
function dismiss(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    versionVisible.value = false
    menuNameVisible.value = false
  }
}
function outside(event: PointerEvent): void {
  if (!rail.value?.contains(event.target as Node)) {
    versionVisible.value = false
    menuNameVisible.value = false
  }
}
onMounted(() => document.addEventListener('pointerdown', outside))
onUnmounted(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <aside ref="rail" class="sidebar" aria-label="工具导航" @keydown="dismiss">
    <TButton
      class="rail-logo"
      theme="default"
      variant="text"
      type="button"
      aria-label="开源好物，返回工具库"
      @click="home"
    >
      <img :src="brandLogo" alt="" width="36" height="36" />
    </TButton>
    <div class="rail-divider" aria-hidden="true"></div>
    <nav
      class="rail-nav"
      aria-label="主导航"
      @pointerenter="menuNameVisible = true"
      @pointerleave="menuNameVisible = false"
    >
      <TButton
        class="rail-trigger is-active"
        theme="default"
        variant="text"
        type="button"
        aria-label="所有工具"
        aria-current="page"
        :aria-describedby="menuNameVisible ? 'rail-menu-name' : undefined"
        @focus="menuNameVisible = true"
        @blur="menuNameVisible = false"
        @click="home"
        ><Wrench :size="21" aria-hidden="true"
      /></TButton>
      <Transition name="rail-flyout"
        ><div v-if="menuNameVisible" id="rail-menu-name" class="rail-name-tooltip" role="tooltip">
          所有工具
        </div></Transition
      >
    </nav>
    <div
      class="rail-bottom"
      @pointerenter="versionVisible = true"
      @pointerleave="versionVisible = false"
    >
      <TButton
        class="rail-status"
        theme="default"
        variant="text"
        type="button"
        :aria-label="`本地工作区，TOOLBOX v${version}`"
        :aria-describedby="versionVisible ? 'rail-version' : undefined"
        @focus="versionVisible = true"
        @blur="versionVisible = false"
        @click="versionVisible = true"
      >
        <span class="rail-status-dot" aria-hidden="true"></span>
      </TButton>
      <Transition name="rail-flyout"
        ><div v-if="versionVisible" id="rail-version" class="rail-version" role="tooltip">
          <span><HardDrive :size="14" aria-hidden="true" />本地工作区</span
          ><strong
            >TOOLBOX <span>v{{ version }}</span></strong
          >
        </div></Transition
      >
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: var(--sidebar-width);
  padding: 18px 0 16px;
  overflow: visible;
  color: var(--sidebar-text);
  background: var(--sidebar-bg);
  border-right: 1px solid #ffffff0a;
}
.rail-logo.t-button,
.rail-trigger.t-button,
.rail-status.t-button {
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 12px;
  color: var(--sidebar-text);
  background: transparent;
}
.rail-logo img {
  display: block;
  object-fit: contain;
}
.rail-divider {
  width: 28px;
  height: 1px;
  margin: 18px 0;
  background: #ffffff12;
}
.rail-nav {
  position: relative;
  display: grid;
  gap: 10px;
}
.rail-trigger.t-button {
  overflow: visible;
  transition:
    background-color 180ms,
    color 180ms;
}
.rail-trigger svg {
  transition: transform 180ms var(--motion-ease);
}
.rail-trigger.t-button:hover {
  color: #60a5fa;
  background: #1e293b;
}
.rail-trigger.t-button.is-active {
  color: #60a5fa;
  background: #3b82f61f;
}
.rail-trigger.is-active::before {
  content: '';
  position: absolute;
  left: -14px;
  top: 14px;
  width: 3px;
  height: 16px;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
}
.rail-trigger:hover svg,
.rail-trigger:focus-visible svg {
  transform: scale(1.1);
}
.rail-logo.t-button:hover,
.rail-status.t-button:hover {
  background: #1e293b;
}
.sidebar .t-button:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 3px;
}
.rail-version,
.rail-name-tooltip {
  position: absolute;
  left: calc(100% + 22px);
  width: 248px;
  color: #cbd5e1;
  background: var(--sidebar-bg);
  border: 1px solid #334155;
  border-radius: 14px;
  box-shadow:
    0 8px 18px #0f172a16,
    0 24px 56px #0f172a33;
}
.rail-name-tooltip {
  top: 2px;
  width: max-content;
  padding: 10px 14px;
  border-radius: 9px;
  font-size: 13px;
  line-height: 18px;
  white-space: nowrap;
}
.rail-name-tooltip::before {
  content: '';
  position: absolute;
  right: 100%;
  top: 0;
  bottom: 0;
  width: 24px;
}
.rail-bottom {
  position: relative;
  margin-top: auto;
}
.rail-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #60a5fa;
  box-shadow: 0 0 0 4px #3b82f614;
}
.rail-version {
  bottom: 0;
  width: max-content;
  padding: 14px 16px;
  pointer-events: none;
}
.rail-version > span {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
  font-size: 12px;
}
.rail-version strong {
  display: flex;
  align-items: center;
  gap: 14px;
  color: #f1f5f9;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1px;
}
.rail-version strong span {
  color: #b9c7dc;
  letter-spacing: 0;
}
.rail-flyout-enter-active {
  transition:
    opacity 160ms ease-out,
    transform 160ms var(--motion-ease);
}
.rail-flyout-leave-active {
  transition:
    opacity 100ms ease-in,
    transform 100ms ease-in;
  pointer-events: none;
}
.rail-flyout-enter-from,
.rail-flyout-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}
@media (prefers-reduced-motion: reduce) {
  .rail-trigger svg,
  .rail-flyout-enter-from,
  .rail-flyout-leave-to {
    transform: none !important;
  }
}
</style>
