import { useEffect, useRef, useState } from 'react'
import { DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildSuitModel } from './suitModel'
import { METRICS, STATUS_COLOR, type MetricKey } from '../config/thresholds'
import { useTelemetrySelect } from '../hooks/useTelemetry'
import { AnimatedNumber } from './AnimatedNumber'
import { OriginTag } from './OriginTag'

interface Part {
  id: string
  name: string
  blurb: string
  pos: [number, number, number]
  metrics: MetricKey[]
}

const PARTS: Part[] = [
  { id: 'helmet', name: 'Helmet / HUD', blurb: 'Gold-coated visor, heads-up telemetry overlay', pos: [0, 1.95, 0.42], metrics: ['spo2', 'visorTemp', 'signal'] },
  { id: 'plss', name: 'PLSS Backpack', blurb: 'Primary life-support: oxygen, power, cooling loop', pos: [0, 1.15, -0.55], metrics: ['suitPressure', 'o2Tank', 'battery', 'coolantTemp'] },
  { id: 'chest', name: 'Biometric Chest Sensor', blurb: 'ECG, respiration and core temperature patch', pos: [0.18, 1.3, 0.4], metrics: ['heartRate', 'bodyTemp', 'respRate'] },
  { id: 'gloves', name: 'Pressurized Gloves', blurb: 'Heated glove liner with tactile pressure sensing', pos: [-0.88, 0.62, 0.18], metrics: ['gloveTemp', 'outsideTemp', 'wind'] },
  { id: 'boots', name: 'Thermal Boots', blurb: 'Insulated sole against regolith heat sink', pos: [0.26, -0.05, 0.22], metrics: ['bootTemp', 'radiation', 'roverRange'] },
]

function PartData({ part }: { part: Part }) {
  return (
    <div className="grid gap-2">
      {part.metrics.map((k) => (
        <Row key={k} k={k} />
      ))}
    </div>
  )
}

function Row({ k }: { k: MetricKey }) {
  const v = useTelemetrySelect((s) => s.latest?.[k] ?? NaN)
  const st = useTelemetrySelect((s) => s.statuses[k])
  const c = METRICS[k]
  return (
    <div className="flex items-baseline justify-between" data-status={st}>
      <span className="label flex items-center gap-2">
        <span className="inline-block h-[5px] w-[5px] rounded-full" style={{ background: STATUS_COLOR[st] }} />
        {c.label}
        <OriginTag k={k} />
      </span>
      <span className="flex items-baseline gap-1">
        <AnimatedNumber value={v} decimals={c.decimals} className="display text-[20px]" />
        <span className="unit">{c.unit}</span>
      </span>
    </div>
  )
}

export default function SuitInspector({ height = 320 }: { height?: number }) {
  const mount = useRef<HTMLDivElement>(null)
  const btns = useRef<Record<string, HTMLButtonElement | null>>({})
  const [sel, setSel] = useState('chest')
  const selRef = useRef(sel)
  selRef.current = sel

  useEffect(() => {
    const el = mount.current!
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setClearColor(0x000000, 0)
    el.prepend(renderer.domElement)
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:pan-y'
    renderer.domElement.setAttribute('aria-hidden', 'true')

    const scene = new Scene()
    const camera = new PerspectiveCamera(32, 1, 0.1, 50)
    camera.position.set(3.3, 1.6, 5.2)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false
    controls.enableDamping = true
    controls.minDistance = 3.2
    controls.maxDistance = 8
    controls.target.set(0, 1.05, 0)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    controls.autoRotate = !reduce
    controls.autoRotateSpeed = 1.1
    const stopAutoRotate = () => (controls.autoRotate = false)
    controls.addEventListener('start', stopAutoRotate)

    const hemi = new HemisphereLight(0xdfe6ee, 0x3a2a22, 1.0)
    const key = new DirectionalLight(0xfff1e2, 2.2)
    key.position.set(3, 4, 3)
    const rim = new DirectionalLight(0x7fd8ff, 1.3)
    rim.position.set(-4, 2, -3)
    scene.add(hemi, key, rim)

    const model = buildSuitModel()
    scene.add(model.group)

    const fit = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)

    const v = new Vector3()
    const toPart = new Vector3()
    const normal = new Vector3()
    const want = new Vector3(0, 1.05, 0)
    let raf = 0
    let visible = true
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
    io.observe(el)

    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (!visible) return
      const p = PARTS.find((x) => x.id === selRef.current)
      if (p) want.set(p.pos[0] * 0.35, 0.5 + p.pos[1] * 0.5, 0)
      controls.target.lerp(want, 0.05)
      controls.update()
      model.update(selRef.current, performance.now(), !reduce)
      renderer.render(scene, camera)
      const w = el.clientWidth
      const h = el.clientHeight
      for (const part of PARTS) {
        const b = btns.current[part.id]
        if (!b) continue
        v.set(...part.pos).project(camera)
        toPart.set(...part.pos).sub(camera.position)
        normal.set(part.pos[0], 0, part.pos[2] + (part.id === 'plss' ? 0.2 : 0)).normalize()
        const front = toPart.dot(normal) < 0
        b.style.transform = `translate(${((v.x + 1) / 2) * w - 14}px, ${((1 - v.y) / 2) * h - 14}px)`
        b.style.opacity = front ? '1' : '0.25'
      }
    }
    frame()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      controls.removeEventListener('start', stopAutoRotate)
      controls.dispose()
      model.dispose()
      renderer.dispose()
      // release the WebGL context now instead of waiting for GC (tab switches remount this component)
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [])

  const part = PARTS.find((p) => p.id === sel)!
  return (
    <div>
      <div ref={mount} className="relative" style={{ height }}>
        {PARTS.map((p) => (
          <button
            key={p.id}
            ref={(n) => {
              btns.current[p.id] = n
            }}
            aria-label={`Inspect ${p.name}`}
            aria-pressed={sel === p.id}
            onClick={() => setSel(p.id)}
            className="absolute left-0 top-0 grid h-7 w-7 place-items-center rounded-full"
            style={{ border: `1px solid ${sel === p.id ? '#ff6a1f' : 'rgba(255,255,255,.55)'}`, background: sel === p.id ? 'rgba(255,106,31,.35)' : 'rgba(20,14,11,.55)', cursor: 'pointer', backdropFilter: 'blur(4px)' }}
          >
            <span className="block h-[7px] w-[7px] rounded-full" style={{ background: sel === p.id ? '#ff6a1f' : '#f2e9e1' }} />
          </button>
        ))}
        <span className="label absolute bottom-1 left-1">drag to rotate · tap a marker</span>
      </div>
      <div className="mt-3 rounded-xl p-3" style={{ border: '1px solid var(--hair)', background: 'rgba(0,0,0,.25)' }} aria-live="polite">
        <div className="display text-[17px]">{part.name}</div>
        <p className="label mb-3 mt-1 normal-case" style={{ letterSpacing: '.04em', textTransform: 'none' }}>
          {part.blurb}
        </p>
        <PartData part={part} />
      </div>
    </div>
  )
}
