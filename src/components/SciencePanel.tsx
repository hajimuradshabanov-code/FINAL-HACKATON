import { useState, useSyncExternalStore } from 'react'
import { METRICS } from '../config/thresholds'
import { useTelemetrySelect } from '../hooks/useTelemetry'
import { useDomId } from '../hooks/useDomId'
import { habitatSetting } from '../science/engine'
import { ATMOSPHERES, NASA_TR_REFERENCE, earthMarsLink, habitatN2, heliocentric, prebreatheMinutes, tissueRatio } from '../science/models'
import { STATUS_COLOR } from '../config/thresholds'
import { formatNumber } from '../lib/format'
import { SRC } from '../science/methods'
import { Big, Card, Note, useNow } from './scienceUi'
import { BaselineCard, EvidenceView, HindcastCard, JointCard, MethodsView, RadiationDecisionCard, ValidationCard, OsdrCard } from './ScienceEvidence'

// ---- 1. Earth–Mars link -------------------------------------------------------------------
function OrbitDiagram({ now }: { now: number }) {
  const e = heliocentric('emb', now)
  const m = heliocentric('mars', now)
  const S = 62 // px per au
  const c = 110
  const p = (v: number[]) => [c + v[0] * S, c - v[1] * S] as const
  const [ex, ey] = p(e)
  const [mx, my] = p(m)
  return (
    <svg viewBox="0 0 220 220" className="mx-auto w-full max-w-[260px]" role="img" aria-label="Positions of Earth and Mars around the Sun today, seen from above the ecliptic">
      <circle cx={c} cy={c} r={1.0 * S} fill="none" stroke="rgba(255,255,255,.14)" />
      <circle cx={c} cy={c} r={1.524 * S} fill="none" stroke="rgba(255,255,255,.14)" strokeDasharray="2 3" />
      <line x1={ex} y1={ey} x2={mx} y2={my} stroke="#ff6a1f" strokeWidth="1.2" strokeDasharray="3 3" />
      <circle cx={c} cy={c} r="7" fill="#f2b04c" style={{ filter: 'drop-shadow(0 0 8px #f2b04c)' }} />
      <circle cx={ex} cy={ey} r="4.5" fill="#7fd8ff" />
      <circle cx={mx} cy={my} r="4.5" fill="#ff6a1f" />
      <text x={ex + 7} y={ey - 6} fill="#a8978a" fontSize="9" fontFamily="IBM Plex Mono">
        Earth
      </text>
      <text x={mx + 7} y={my - 6} fill="#a8978a" fontSize="9" fontFamily="IBM Plex Mono">
        Mars
      </text>
    </svg>
  )
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

function EarthLinkCard({ className }: { className?: string }) {
  const now = useNow(60_000)
  const link = earthMarsLink(now)
  const conjunction = link.sunAngleDeg < 5
  return (
    <Card
      className={className}
      title="Earth link"
      method="Today’s heliocentric positions from JPL’s Keplerian elements (Table 1, valid 1800–2050); delay = distance ÷ speed of light. Near solar conjunction the Sun’s corona degrades radio links (the 5° flag is an app heuristic)."
      sources={[SRC.jpl]}
    >
      <OrbitDiagram now={now} />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="label">One-way signal delay</div>
          <Big value={mmss(link.oneWayS)} unit="min" />
        </div>
        <div>
          <div className="label">Question → answer</div>
          <Big value={mmss(link.oneWayS * 2)} unit="min" />
        </div>
      </div>
      <Note>
        Mars is {formatNumber(link.distanceKm / 1e6, 0)} million km ({formatNumber(link.distanceAu, 2)} au) away; the Sun is {formatNumber(link.sunAngleDeg, 0)}° from Mars as seen from Earth.{' '}
        {conjunction ? <b style={{ color: 'var(--warn)' }}>Close to solar conjunction: expect a communications blackout — the crew must self-manage.</b> : 'Any call for help waits at least the round-trip time, which is why the crew self-assesses first.'}
      </Note>
    </Card>
  )
}

// ---- 2. Heat strain (PSI) -------------------------------------------------------------------
function HeatStrainCard({ className }: { className?: string }) {
  const psi = useTelemetrySelect((s) => s.science.psi)
  const color = !psi ? 'var(--taupe)' : psi.value >= 7.5 ? STATUS_COLOR.critical : psi.value >= 5 ? STATUS_COLOR.warning : STATUS_COLOR.normal
  return (
    <Card
      className={className}
      title="Heat strain"
      method="Physiological Strain Index, PSI = 5(Tc−Tc₀)/(39.5−Tc₀) + 5(HR−HR₀)/(180−HR₀), against this session’s resting baseline (first 30 s). Chest-patch core temperature stands in for rectal temperature; PSI ≥ 7.5 was the “at risk” cut-off in Buller et al. 2008."
      sources={[SRC.psi, SRC.buller08]}
    >
      {psi ? (
        <>
          <div className="flex items-end justify-between">
            <Big value={formatNumber(psi.value, 1)} unit="/ 10" color={color} />
            <span className="label" style={{ color }}>
              {psi.category === 'none' ? 'no' : psi.category} strain
            </span>
          </div>
          <div className="relative h-[6px] rounded-full" style={{ background: 'rgba(255,255,255,.1)' }} aria-hidden="true">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${psi.value * 10}%`, background: color, transition: 'width .6s' }} />
            <div className="absolute -top-1 h-[14px] w-px" style={{ left: '75%', background: STATUS_COLOR.critical }} title="7.5: at-risk cut-off" />
          </div>
          <Note>
            Cardiovascular part {formatNumber(psi.hrPart, 1)} (HR baseline {formatNumber(psi.baseline.hr, 0)} bpm) · thermal part {formatNumber(psi.tcPart, 1)} (core baseline {formatNumber(psi.baseline.tc, 1)} °C).
          </Note>
        </>
      ) : (
        <Note>Collecting a resting baseline…</Note>
      )}
    </Card>
  )
}

// ---- 3. Core-temperature cross-check (ECTemp) --------------------------------------------------
function CoreTempCard({ className }: { className?: string }) {
  const ec = useTelemetrySelect((s) => s.science.ectemp)
  const disagree = ec && Math.abs(ec.diff) > 0.5
  return (
    <Card
      className={className}
      title="Core temperature cross-check"
      method="ECTemp: an extended Kalman filter estimates core temperature from the sequence of 1-minute mean heart rates (a = 1, γ = 0.022, HR = −4.5714·CT² + 384.4286·CT − 7887.1, σ = 18.88, CT₀ = 37.1 °C). It is an independent ‘virtual sensor’; the 0.5 °C disagreement flag is an app heuristic."
      sources={[SRC.ectemp]}
    >
      {ec ? (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="label">Chest patch</div>
              <Big value={formatNumber(ec.measured, 1)} unit="°C" />
            </div>
            <div>
              <div className="label">Estimated from heart rate</div>
              <Big value={formatNumber(ec.estimate, 1)} unit="°C" />
            </div>
          </div>
          <Note>
            {disagree ? (
              <b style={{ color: 'var(--warn)' }}>The two disagree by {formatNumber(Math.abs(ec.diff), 1)} °C — check the patch contact before trusting either value.</b>
            ) : (
              <>Agreement within {formatNumber(Math.abs(ec.diff), 1)} °C after {ec.minutes} min of heart-rate data.</>
            )}
          </Note>
        </>
      ) : (
        <Note>The heart-rate estimate appears after the first full minute of data.</Note>
      )}
    </Card>
  )
}

// ---- 4. Decompression (tissue ratio) ------------------------------------------------------------
function DecompressionCard({ className }: { className?: string }) {
  const dcs = useTelemetrySelect((s) => s.science.dcs)
  const suit = useTelemetrySelect((s) => (Number.isFinite(s.latest?.suitPressure) ? s.latest!.suitPressure : 4.3))
  const current = useSyncExternalStore(habitatSetting.subscribe, habitatSetting.get)
  const groupId = useDomId('atmo')
  return (
    <Card
      className={className}
      title="EVA decompression stress"
      method={`Tissue ratio TR = N₂ tension in NASA’s theoretical 360-min half-time tissue ÷ suit pressure. The tissue equilibrates with the habitat and washes out while breathing 100 % O₂ in the suit. Dry-gas partial pressures (no water vapour). This model gives TR 1.22 for 8.2 psia / 34 % O₂ + 15 min prebreathe; NASA modelled ≈ ${NASA_TR_REFERENCE.tr}. TR is a relative stress measure, not a go/no-go limit.`}
      sources={[SRC.dcs]}
    >
      <fieldset className="grid gap-1.5">
        <legend id={groupId} className="label mb-1.5">
          Habitat atmosphere
        </legend>
        <div className="grid gap-1.5">
          {ATMOSPHERES.map((a) => {
            const on = current === a.id
            const tr0 = tissueRatio(habitatN2(a), suit)
            const pb = prebreatheMinutes(habitatN2(a), suit, NASA_TR_REFERENCE.tr)
            return (
              <label key={a.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[13px]" style={{ border: `1px solid ${on ? 'rgba(255,106,31,.55)' : 'var(--hair)'}`, background: on ? 'rgba(193,68,14,.14)' : 'rgba(0,0,0,.22)', color: 'var(--ink)' }}>
                <input type="radio" name={groupId} checked={on} onChange={() => habitatSetting.set(a.id)} style={{ accentColor: '#ff6a1f' }} />
                <span className="flex-1">
                  {a.label}
                  <span className="block text-[11.5px]" style={{ color: 'var(--taupe)' }}>
                    {a.psia} psia · {Math.round(a.fo2 * 1000) / 10} % O₂ · ppN₂ {formatNumber(habitatN2(a), 2)} psia
                  </span>
                </span>
                <span className="num text-right text-[12px]" style={{ color: 'var(--taupe)' }}>
                  TR {formatNumber(tr0, 2)}
                  <span className="block">{pb < 1 ? 'no prebreathe' : `${formatNumber(pb, 0)} min O₂`}</span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>
      {dcs && (
        <>
          <div className="flex items-end justify-between">
            <div>
              <div className="label">{dcs.eva ? 'TR now (in the suit)' : 'TR if an EVA started now'}</div>
              <Big value={formatNumber(dcs.tr, 2)} color={dcs.tr <= NASA_TR_REFERENCE.tr + 0.05 ? STATUS_COLOR.normal : dcs.tr < 1.6 ? STATUS_COLOR.warning : STATUS_COLOR.critical} />
            </div>
            <div className="text-right">
              <div className="label">O₂ prebreathe to reach TR {NASA_TR_REFERENCE.tr}</div>
              <Big value={dcs.prebreatheMin < 1 ? '0' : formatNumber(dcs.prebreatheMin, 0)} unit="min" />
            </div>
          </div>
          <Note>
            Tissue N₂ {formatNumber(dcs.tissueN2, 2)} psia vs habitat ppN₂ {formatNumber(dcs.habitatN2, 2)} psia, suit {formatNumber(suit, 2)} psia. Lower-pressure, oxygen-rich habitats cut prebreathe from hours to minutes — the reason NASA chose 8.2 psia / 34 % O₂ for exploration.
          </Note>
        </>
      )}
    </Card>
  )
}

// ---- 6. Early warning -------------------------------------------------------------------------
function ForecastCard({ className }: { className?: string }) {
  const forecasts = useTelemetrySelect((s) => s.science.forecasts)
  return (
    <Card
      className={className}
      title="Early warning"
      method="Least-squares trend over the last 60 s of each vital, extrapolated to its warning threshold. Reported only with R² ≥ 0.6, a crossing within 15 min, and once the vital has spent 6 s at least 2.5 σ outside the personal norm in that direction (app choices; measured on the Evidence tab)."
      sources={[]}
    >
      {forecasts.length === 0 ? (
        <Note>No vital is trending toward its warning threshold.</Note>
      ) : (
        <ul className="grid gap-2">
          {forecasts.map((f) => {
            const c = METRICS[f.key]
            return (
              <li key={f.key} className="rounded-lg px-3 py-2 text-[13.5px]" style={{ border: `1px solid ${STATUS_COLOR.warning}66`, background: 'rgba(242,176,76,.07)', color: 'var(--ink)' }}>
                <b>{c.label}</b> {f.direction} {formatNumber(Math.abs(f.slopePerMin), c.decimals + 1)} {c.unit}/min → reaches {formatNumber(f.threshold, c.decimals)} {c.unit} in about <b>{f.minutes < 1 ? `${Math.max(1, Math.round(f.minutes * 60))} s` : `${formatNumber(f.minutes, 1)} min`}</b>
                <span className="block text-[11.5px]" style={{ color: 'var(--taupe)' }}>
                  fit R² {formatNumber(f.r2, 2)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

type Section = 'live' | 'evidence' | 'methods'
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'live', label: 'Live models' },
  { id: 'evidence', label: 'Evidence & validation' },
  { id: 'methods', label: 'Methods' },
]

/** The Science tab: models on the live stream, the evidence behind them, and how each is computed. */
export function ScienceView({ layout }: { layout: 'desktop' | 'mobile' }) {
  const [section, setSection] = useState<Section>('live')
  const nav = (
    <div role="tablist" aria-label="Science sections" className={`flex gap-1.5 ${layout === 'mobile' ? 'overflow-x-auto' : 'mb-5'}`}>
      {SECTIONS.map((s) => {
        const on = s.id === section
        return (
          <button key={s.id} role="tab" aria-selected={on} onClick={() => setSection(s.id)} className="label shrink-0 rounded-full px-3.5 py-2" style={{ border: `1px solid ${on ? 'rgba(255,106,31,.6)' : 'var(--hair)'}`, background: on ? 'rgba(193,68,14,.2)' : 'rgba(0,0,0,.25)', color: on ? 'var(--ink)' : 'var(--taupe)', cursor: 'pointer' }}>
            {s.label}
          </button>
        )
      })}
    </div>
  )
  if (layout === 'mobile') {
    return (
      <>
        {nav}
        {section === 'live' && (
          <>
            <RadiationDecisionCard />
            <BaselineCard />
            <JointCard />
            <ForecastCard />
            <HeatStrainCard />
            <CoreTempCard />
            <DecompressionCard />
            <EarthLinkCard />
          </>
        )}
        {section === 'evidence' && (
          <>
            <ValidationCard />
            <HindcastCard />
            <OsdrCard />
          </>
        )}
        {section === 'methods' && <MethodsView />}
      </>
    )
  }
  return (
    <div>
      {nav}
      {section === 'live' && (
        <div className="grid grid-cols-12 items-start gap-5">
          <div className="col-span-5 grid gap-5">
            <RadiationDecisionCard />
            <EarthLinkCard />
          </div>
          <div className="col-span-4 grid gap-5">
            <BaselineCard />
            <JointCard />
            <ForecastCard />
          </div>
          <div className="col-span-3 grid gap-5">
            <HeatStrainCard />
            <CoreTempCard />
            <DecompressionCard />
          </div>
        </div>
      )}
      {section === 'evidence' && <EvidenceView />}
      {section === 'methods' && <MethodsView />}
    </div>
  )
}
