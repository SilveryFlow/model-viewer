<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const hostRef = useTemplateRef<HTMLElement>('host')
const fileInputRef = useTemplateRef<HTMLInputElement>('fileInput')
const panelRef = useTemplateRef<HTMLElement>('panel')

const isDragging = ref(false)
const isLoading = ref(false)
const hasModel = ref(false)
const statusText = ref('拖拽模型文件，或点击右下角“选择文件”开始预览')
const isPanelCollapsed = ref(false)
const isPanelDragging = ref(false)
const requiredExtensions = ref<string[]>([])
const usedExtensions = ref<string[]>([])
const panelPosition = ref({ x: 16, y: 16 })

const panelStyle = computed(() => ({
  left: `${panelPosition.value.x}px`,
  top: `${panelPosition.value.y}px`,
}))

let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let controls: OrbitControls | null = null
let pmremGenerator: THREE.PMREMGenerator | null = null
let fillLight: THREE.HemisphereLight | null = null
let keyLight: THREE.DirectionalLight | null = null

let loadingManager: THREE.LoadingManager | null = null
let gltfLoader: GLTFLoader | null = null
let dracoLoader: DRACOLoader | null = null
let ktx2Loader: KTX2Loader | null = null

let animationFrameId = 0
let resizeObserver: ResizeObserver | null = null
let activeModel: THREE.Object3D | null = null
let dragDepth = 0
let panelPointerId: number | null = null
let panelPointerOffsetX = 0
let panelPointerOffsetY = 0

let assetMap = new Map<string, File>()
const trackedObjectUrls = new Set<string>()
let transientResourceUrls: string[] = []

const clampNumber = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max)
}

const clampPanelPosition = () => {
  const host = hostRef.value
  const panel = panelRef.value

  if (!host || !panel) {
    return
  }

  const margin = 8
  const maxX = Math.max(host.clientWidth - panel.offsetWidth - margin, margin)
  const maxY = Math.max(host.clientHeight - panel.offsetHeight - margin, margin)

  panelPosition.value = {
    x: clampNumber(panelPosition.value.x, margin, maxX),
    y: clampNumber(panelPosition.value.y, margin, maxY),
  }
}

const toExtensionList = (extensions: unknown) => {
  if (!Array.isArray(extensions)) {
    return []
  }

  return extensions.filter((extension): extension is string => typeof extension === 'string')
}

// 解析 glTF 原始 JSON 中的扩展声明：
// - extensionsRequired: 当前模型加载必须支持
// - extensionsUsed: 当前模型声明使用过
const extractExtensionInfo = (gltf: GLTF) => {
  const parserJson = (
    gltf as GLTF & {
      parser?: { json?: { extensionsRequired?: string[]; extensionsUsed?: string[] } }
    }
  ).parser?.json

  return {
    required: toExtensionList(parserJson?.extensionsRequired),
    used: toExtensionList(parserJson?.extensionsUsed),
  }
}

const removePanelDragListeners = () => {
  window.removeEventListener('pointermove', onPanelPointerMove)
  window.removeEventListener('pointerup', onPanelPointerUp)
  window.removeEventListener('pointercancel', onPanelPointerUp)
}

const onPanelPointerMove = (event: PointerEvent) => {
  if (panelPointerId !== event.pointerId) {
    return
  }

  const host = hostRef.value
  const panel = panelRef.value

  if (!host || !panel) {
    return
  }

  const hostRect = host.getBoundingClientRect()
  const nextX = event.clientX - hostRect.left - panelPointerOffsetX
  const nextY = event.clientY - hostRect.top - panelPointerOffsetY

  panelPosition.value = {
    x: nextX,
    y: nextY,
  }

  clampPanelPosition()
}

const onPanelPointerUp = (event: PointerEvent) => {
  if (panelPointerId !== event.pointerId) {
    return
  }

  panelPointerId = null
  isPanelDragging.value = false
  removePanelDragListeners()
}

const onPanelPointerDown = (event: PointerEvent) => {
  if (event.button !== 0) {
    return
  }

  const panel = panelRef.value
  if (!panel) {
    return
  }

  const panelRect = panel.getBoundingClientRect()
  // 记录指针与面板左上角的偏移，拖动时避免出现跳动。
  panelPointerId = event.pointerId
  panelPointerOffsetX = event.clientX - panelRect.left
  panelPointerOffsetY = event.clientY - panelRect.top
  isPanelDragging.value = true

  removePanelDragListeners()
  window.addEventListener('pointermove', onPanelPointerMove)
  window.addEventListener('pointerup', onPanelPointerUp)
  window.addEventListener('pointercancel', onPanelPointerUp)
}

const togglePanelCollapsed = async () => {
  isPanelCollapsed.value = !isPanelCollapsed.value
  await nextTick()
  clampPanelPosition()
}

const addTrackedUrl = (url: string) => {
  trackedObjectUrls.add(url)
  return url
}

const revokeTrackedUrl = (url: string) => {
  if (!trackedObjectUrls.has(url)) {
    return
  }

  URL.revokeObjectURL(url)
  trackedObjectUrls.delete(url)
}

const revokeTransientResourceUrls = () => {
  for (const url of transientResourceUrls) {
    URL.revokeObjectURL(url)
  }
  transientResourceUrls = []
}

const normalizeAssetPath = (path: string) => {
  return (
    decodeURIComponent(path)
      .replace(/^blob:[^/]+\//, '')
      .replace(/^\.?\//, '')
      .replace(/^\//, '')
      .replace(/\\/g, '/')
      .split(/[?#]/)[0] ?? ''
  )
}

// 根据 URL 尝试匹配拖拽/选择的本地文件。
// 这里会同时尝试完整路径和 basename，兼容：
// - ./robot_data.bin
// - textures/robot_data.bin
// - http(s)://host/path/robot_data.bin
const findAssetFileByUrl = (url: string) => {
  const keys = new Set<string>()

  const addKey = (value: string | undefined) => {
    const normalized = normalizeAssetPath(value ?? '')
    if (!normalized) {
      return
    }

    keys.add(normalized)
    keys.add(normalized.toLowerCase())

    const basename = normalized.split('/').pop()
    if (basename) {
      keys.add(basename)
      keys.add(basename.toLowerCase())
    }
  }

  addKey(url)

  try {
    const parsed = new URL(url, window.location.href)
    addKey(parsed.pathname)
  } catch {
    // 非标准 URL（例如相对路径）不做额外处理。
  }

  for (const key of keys) {
    const file = assetMap.get(key)
    if (file) {
      return file
    }
  }

  return null
}

const buildAssetMap = (files: File[]) => {
  const nextMap = new Map<string, File>()

  for (const file of files) {
    const name = normalizeAssetPath(file.name)
    const lowerName = name.toLowerCase()
    nextMap.set(name, file)
    nextMap.set(lowerName, file)

    const relativePath = normalizeAssetPath(file.webkitRelativePath || '')
    if (relativePath) {
      const lowerRelativePath = relativePath.toLowerCase()
      nextMap.set(relativePath, file)
      nextMap.set(lowerRelativePath, file)

      const basename = relativePath.split('/').pop()
      if (basename) {
        nextMap.set(basename, file)
        nextMap.set(basename.toLowerCase(), file)
      }
    }
  }

  return nextMap
}

const resolveAssetUrl = (url: string) => {
  if (!assetMap.size || /^data:/i.test(url)) {
    return url
  }

  const file = findAssetFileByUrl(url)

  if (!file) {
    return url
  }

  const mappedUrl = URL.createObjectURL(file)
  transientResourceUrls.push(mappedUrl)
  return mappedUrl
}

const disposeMaterial = (material: THREE.Material) => {
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (value instanceof THREE.Texture) {
      value.dispose()
    }
  }

  material.dispose()
}

const disposeObjectTree = (object: THREE.Object3D) => {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return
    }

    child.geometry.dispose()

    if (Array.isArray(child.material)) {
      child.material.forEach(disposeMaterial)
      return
    }

    disposeMaterial(child.material)
  })
}

const clearModel = () => {
  if (!scene || !activeModel) {
    requiredExtensions.value = []
    usedExtensions.value = []
    return
  }

  scene.remove(activeModel)
  disposeObjectTree(activeModel)
  activeModel = null
  hasModel.value = false
  requiredExtensions.value = []
  usedExtensions.value = []
}

const applyAdaptiveSceneLook = (model: THREE.Object3D) => {
  if (!scene || !renderer || !fillLight || !keyLight) {
    return
  }

  let materialCount = 0
  let luminanceSum = 0
  let metallicSum = 0

  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material]

    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) {
        continue
      }

      const c = material.color
      const luminance = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722
      luminanceSum += luminance
      metallicSum += material.metalness
      materialCount += 1
    }
  })

  const averageLuminance = materialCount > 0 ? luminanceSum / materialCount : 0.55
  const averageMetalness = materialCount > 0 ? metallicSum / materialCount : 0

  let bgColor = 0xe8e8e8
  let exposure = 1
  let fillIntensity = 1.1
  let keyIntensity = 1.1

  if (averageLuminance < 0.34) {
    bgColor = 0xf0f0ed
    exposure = 1.12
    fillIntensity = 1.2
    keyIntensity = 1.25
  } else if (averageLuminance > 0.78) {
    bgColor = 0x242734
    exposure = 0.92
    fillIntensity = 0.95
    keyIntensity = 1.45
  } else if (averageMetalness > 0.45) {
    bgColor = 0xdfe5ec
    exposure = 1.15
    fillIntensity = 1.18
    keyIntensity = 1.55
  }

  scene.background = new THREE.Color(bgColor)
  renderer.toneMappingExposure = exposure
  fillLight.intensity = fillIntensity
  keyLight.intensity = keyIntensity
}

const frameModel = (model: THREE.Object3D) => {
  if (!camera || !controls) {
    return
  }

  const box = new THREE.Box3().setFromObject(model)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z) || 1

  model.position.sub(center)

  const fovRadians = (camera.fov * Math.PI) / 180
  const distance = maxDimension / (2 * Math.tan(fovRadians / 2))

  camera.position.set(distance * 1.2, distance * 0.8, distance * 1.2)
  camera.near = Math.max(distance / 120, 0.01)
  camera.far = Math.max(distance * 120, 120)
  camera.updateProjectionMatrix()

  controls.target.set(0, 0, 0)
  controls.minDistance = distance * 0.2
  controls.maxDistance = distance * 8
  controls.update()
}

const updateRendererSize = () => {
  const host = hostRef.value
  if (!host || !camera || !renderer) {
    return
  }

  const width = host.clientWidth
  const height = host.clientHeight

  if (width === 0 || height === 0) {
    return
  }

  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  clampPanelPosition()
}

const loadModelFromFileSet = (files: File[]) => {
  if (!gltfLoader || !scene) {
    return
  }

  const mainFile = files.find((file) => {
    const lower = file.name.toLowerCase()
    return lower.endsWith('.glb') || lower.endsWith('.gltf')
  })

  if (!mainFile) {
    statusText.value = '请至少提供一个 .glb 或 .gltf 文件'
    return
  }

  assetMap = buildAssetMap(files)

  const mainUrl = addTrackedUrl(URL.createObjectURL(mainFile))
  isLoading.value = true
  statusText.value = `正在加载 ${mainFile.name}...`

  gltfLoader.load(
    mainUrl,
    (gltf) => {
      if (!scene) {
        return
      }

      revokeTrackedUrl(mainUrl)
      revokeTransientResourceUrls()

      clearModel()

      activeModel = gltf.scene
      scene.add(activeModel)

      frameModel(activeModel)
      applyAdaptiveSceneLook(activeModel)
      const extensionInfo = extractExtensionInfo(gltf)
      requiredExtensions.value = extensionInfo.required
      usedExtensions.value = extensionInfo.used

      hasModel.value = true
      isLoading.value = false
      statusText.value = `已加载 ${mainFile.name}（共 ${files.length} 个文件）`
    },
    undefined,
    (error) => {
      revokeTrackedUrl(mainUrl)
      revokeTransientResourceUrls()
      isLoading.value = false
      const message = error instanceof Error ? error.message : String(error)
      statusText.value = `模型加载失败：${message}`
    },
  )
}

const onFileInputChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  if (!files.length) {
    return
  }

  loadModelFromFileSet(files)
  input.value = ''
}

const openFilePicker = () => {
  fileInputRef.value?.click()
}

const onEmptyStateClick = () => {
  if (hasModel.value || isLoading.value) {
    return
  }

  openFilePicker()
}

const onDragEnter = (event: DragEvent) => {
  if (!event.dataTransfer?.types.includes('Files')) {
    return
  }

  dragDepth += 1
  isDragging.value = true
}

const onDragLeave = () => {
  dragDepth = Math.max(dragDepth - 1, 0)
  if (dragDepth === 0) {
    isDragging.value = false
  }
}

const onDrop = (event: DragEvent) => {
  dragDepth = 0
  isDragging.value = false

  const files = event.dataTransfer ? Array.from(event.dataTransfer.files) : []
  if (!files.length) {
    return
  }

  loadModelFromFileSet(files)
}

const startRendering = () => {
  if (!renderer || !scene || !camera || !controls) {
    return
  }

  const safeRenderer = renderer
  const safeScene = scene
  const safeCamera = camera
  const safeControls = controls

  const render = () => {
    safeControls.update()
    safeRenderer.render(safeScene, safeCamera)
    animationFrameId = window.requestAnimationFrame(render)
  }

  animationFrameId = window.requestAnimationFrame(render)
}

onMounted(() => {
  const host = hostRef.value
  if (!host) {
    return
  }

  scene = new THREE.Scene()
  // 初始背景用偏深色，保证引导文案和图标可读性。
  scene.background = new THREE.Color(0x2a3448)

  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000)
  camera.position.set(6, 4, 6)

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.domElement.style.zIndex = '0'
  host.appendChild(renderer.domElement)

  pmremGenerator = new THREE.PMREMGenerator(renderer)
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture

  fillLight = new THREE.HemisphereLight(0xffffff, 0xd5d7df, 1.1)
  keyLight = new THREE.DirectionalLight(0xffffff, 1.1)
  keyLight.position.set(10, 20, 10)
  scene.add(fillLight)
  scene.add(keyLight)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.target.set(0, 0, 0)
  controls.update()

  loadingManager = new THREE.LoadingManager()
  loadingManager.setURLModifier((url) => resolveAssetUrl(url))
  loadingManager.onLoad = () => {
    window.setTimeout(() => revokeTransientResourceUrls(), 0)
  }

  dracoLoader = new DRACOLoader(loadingManager)
  dracoLoader.setDecoderPath('/draco/gltf/')

  ktx2Loader = new KTX2Loader(loadingManager)
  ktx2Loader.setTranscoderPath('/basis/')
  ktx2Loader.detectSupport(renderer)

  gltfLoader = new GLTFLoader(loadingManager)
  gltfLoader.setDRACOLoader(dracoLoader)
  gltfLoader.setKTX2Loader(ktx2Loader)
  gltfLoader.setMeshoptDecoder(MeshoptDecoder)

  resizeObserver = new ResizeObserver(() => {
    updateRendererSize()
  })
  resizeObserver.observe(host)

  updateRendererSize()
  nextTick(() => {
    clampPanelPosition()
  })
  startRendering()
})

onBeforeUnmount(() => {
  window.cancelAnimationFrame(animationFrameId)
  removePanelDragListeners()

  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }

  clearModel()

  revokeTransientResourceUrls()
  for (const url of trackedObjectUrls) {
    URL.revokeObjectURL(url)
  }
  trackedObjectUrls.clear()

  if (controls) {
    controls.dispose()
    controls = null
  }

  if (dracoLoader) {
    dracoLoader.dispose()
    dracoLoader = null
  }

  if (ktx2Loader) {
    ktx2Loader.dispose()
    ktx2Loader = null
  }

  if (pmremGenerator) {
    pmremGenerator.dispose()
    pmremGenerator = null
  }

  if (renderer) {
    renderer.dispose()
    renderer.domElement.remove()
    renderer = null
  }

  loadingManager = null
  gltfLoader = null
  scene = null
  camera = null
  fillLight = null
  keyLight = null
})
</script>

<template>
  <main
    ref="host"
    class="viewer-page"
    relative
    h-full
    w-full
    overflow-hidden
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <input
      ref="fileInput"
      hidden
      type="file"
      multiple
      accept=".glb,.gltf,.bin,.ktx2,.basis,.png,.jpg,.jpeg,.webp"
      @change="onFileInputChange"
    />

    <section
      ref="panel"
      class="panel"
      absolute
      :style="panelStyle"
      flex="~ col"
      gap-2
      z-3
      :class="{ dragging: isPanelDragging, collapsed: isPanelCollapsed }"
    >
      <div
        class="panel-head"
        flex="~ items-center justify-between"
        gap-2
        @pointerdown="onPanelPointerDown"
      >
        <p class="panel-title">模型扩展信息</p>
        <button
          class="panel-toggle"
          type="button"
          :aria-label="isPanelCollapsed ? '展开面板' : '收起面板'"
          @click.stop="togglePanelCollapsed"
        >
          {{ isPanelCollapsed ? '展开' : '收起' }}
        </button>
      </div>

      <div v-show="!isPanelCollapsed" class="panel-body" flex="~ col" gap-2>
        <p class="panel-subtitle">必需扩展（extensionsRequired）</p>
        <ul v-if="requiredExtensions.length" class="extension-list" flex="~ col" gap-1>
          <li
            v-for="extension in requiredExtensions"
            :key="`required-${extension}`"
            class="extension-item"
          >
            {{ extension }}
          </li>
        </ul>
        <p v-else class="extension-empty">未声明必需扩展</p>

        <p class="panel-subtitle">已使用扩展（extensionsUsed）</p>
        <ul v-if="usedExtensions.length" class="extension-list" flex="~ col" gap-1>
          <li v-for="extension in usedExtensions" :key="`used-${extension}`" class="extension-item">
            {{ extension }}
          </li>
        </ul>
        <p v-else class="extension-empty">未检测到已使用扩展</p>
      </div>
    </section>

    <section
      class="empty-state"
      absolute
      inset-0
      flex="~ col items-center justify-center"
      gap-4
      z-2
      :class="{ 'is-hidden': hasModel }"
      role="button"
      tabindex="0"
      aria-label="点击选择模型文件"
      @click="onEmptyStateClick"
      @keydown.enter.prevent="onEmptyStateClick"
      @keydown.space.prevent="onEmptyStateClick"
    >
      <div class="empty-icon" grid="~ place-items-center">◇</div>
      <p class="empty-title">拖拽模型文件开始预览</p>
      <p class="empty-copy">如果是 .gltf，请把相关纹理与 .bin 文件一次性一起拖入。</p>
    </section>

    <section class="bottom-bar" absolute inset-x-0 bottom-0 flex="~ items-center" z-3>
      <p class="status" :class="{ 'is-loading': isLoading }">{{ statusText }}</p>
      <button class="select-btn" type="button" @click="openFilePicker">选择文件</button>
    </section>

    <div
      v-if="isDragging"
      class="drop-mask"
      absolute
      inset-0
      grid="~ place-items-center"
      z-4
      pointer-events-none
    >
      <p>将模型文件拖到这里</p>
    </div>
  </main>
</template>

<style scoped lang="scss">
.viewer-page {
  background: radial-gradient(circle at 50% 42%, #324064 0%, #222c48 58%, #182236 100%);

  .panel {
    width: min(420px, calc(100% - 2rem));
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 16px;
    padding: 0.9rem 1rem;
    backdrop-filter: blur(9px);
    background: linear-gradient(120deg, rgba(23, 32, 53, 0.72), rgba(27, 37, 59, 0.48));
    user-select: none;

    &.dragging {
      cursor: grabbing;
    }

    &.collapsed {
      width: 230px;
    }
  }

  .panel-head {
    cursor: grab;
  }

  .panel-body {
    user-select: text;
  }

  .panel-toggle {
    border: 1px solid rgba(176, 201, 255, 0.38);
    border-radius: 999px;
    padding: 0.16rem 0.6rem;
    background: rgba(71, 95, 145, 0.38);
    color: #e5efff;
    font-size: 0.74rem;
    cursor: pointer;
  }

  .panel-title {
    color: #f4f8ff;
    font-size: 1.05rem;
    letter-spacing: 0.02em;
    font-weight: 600;
  }

  .panel-subtitle {
    color: rgba(220, 231, 255, 0.86);
    font-size: 0.9rem;
  }

  .extension-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .extension-item {
    border-radius: 10px;
    border: 1px solid rgba(176, 201, 255, 0.38);
    padding: 0.26rem 0.5rem;
    font-size: 0.77rem;
    color: #d9e7ff;
    background: rgba(90, 118, 179, 0.26);
  }

  .extension-empty {
    color: rgba(223, 232, 251, 0.74);
    font-size: 0.84rem;
  }

  .empty-state {
    transition: opacity 0.28s ease;
    cursor: pointer;

    &.is-hidden {
      opacity: 0;
      pointer-events: none;
    }

    &:focus-visible {
      outline: 2px solid rgba(170, 196, 255, 0.85);
      outline-offset: -4px;
    }
  }

  .empty-icon {
    width: 92px;
    height: 92px;
    border: 2px solid #88a8f2;
    border-radius: 20px;
    transform: rotate(45deg);
    font-size: 2.8rem;
    line-height: 1;
    color: #9cb6f6;
    text-shadow: 0 10px 18px rgba(8, 13, 25, 0.24);
  }

  .empty-title {
    color: #f4f8ff;
    font-size: clamp(1.05rem, 1.8vw, 1.38rem);
    letter-spacing: 0.02em;
    text-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
  }

  .empty-copy {
    color: rgba(223, 232, 251, 0.83);
    font-size: 0.92rem;
  }

  .bottom-bar {
    padding: 0.78rem 1rem;
    background: rgba(14, 20, 33, 0.76);
    border-top: 1px solid rgba(173, 197, 246, 0.18);
    backdrop-filter: blur(10px);
    gap: 0.9rem;
  }

  .status {
    min-width: 0;
    flex: 1;
    color: #dbe6ff;
    font-size: 0.92rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    &.is-loading {
      color: #ffd2a1;
    }
  }

  .select-btn {
    border: 1px solid rgba(248, 224, 177, 0.44);
    border-radius: 12px;
    background: linear-gradient(135deg, #f29d62 0%, #e87c59 100%);
    color: #ffffff;
    font-size: 0.88rem;
    padding: 0.5rem 0.86rem;
    cursor: pointer;
  }

  .drop-mask {
    border: 2px dashed rgba(168, 196, 255, 0.75);
    background: rgba(19, 27, 46, 0.62);
    color: #e8f0ff;
    font-size: 1.42rem;
    letter-spacing: 0.01em;
  }

  :deep(canvas) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
}

@media (max-width: 768px) {
  .viewer-page {
    .panel {
      width: calc(100% - 1.2rem);
      border-radius: 14px;
      padding: 0.72rem 0.84rem;
    }

    .panel-subtitle {
      font-size: 0.82rem;
    }

    .empty-icon {
      width: 72px;
      height: 72px;
      border-radius: 16px;
      font-size: 2.15rem;
    }

    .empty-copy {
      text-align: center;
      padding-inline: 1rem;
    }

    .bottom-bar {
      padding: 0.64rem 0.72rem;
      gap: 0.56rem;
    }

    .status {
      font-size: 0.82rem;
    }
  }
}
</style>
