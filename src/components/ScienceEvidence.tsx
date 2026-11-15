import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { METRICS, STATUS_COLOR } from '../config/thresholds'
import { useDataMode, useTelemetrySelect } from '../hooks/useTelemetry'
import { nasaLive } from '../data/nasaSource'
import { currentProtons } from '../data/nasaApi'
import { formatNumber } from '../lib/format'
import { BASELINE, BASELINE_KEYS } from '../science/baseline'
import { CAREER_LIMIT_MSV } from '../science/models'
import { METHODS, SRC } from '../science/methods'
import { JOINT, JOINT_KEYS } from '../science/joint'
import { hindcast, RAD_OBSERVED, SEP2017 } from '../science/hindcast'
import { EXCLUDED_DRAWS, osdrAnalysis } from '../science/osdr'
import { ACTION, EXAMPLES, RAD, SHIELDS, assessRadiation, type Advice, type RadiationAssessment, type ShieldId } from '../science/radiation'
import {
  DETECTORS, FAMILIES, VALIDATION_KEYS, runQuiet, runScenario, summarise, validationPlan,
  type Detector, type Family, type FalseAlarmResult, type RunResult, type ValidationReport,
} from '../science/validation'
import stored from '../science/validationReport.json'
import { Big, Card, Note, Sources, linkStyle, td, th, useNow } from './scienceUi'

/** "HEMOGLOBIN" → "Hemoglobin"; acronyms such as ALT, MCV, RDW stay upper-case. */
const analyteName = (a: string) =>
  a
    .replace('; TOTAL', ', total')
    .split(' ')
    .map((w, i) => (/^[A-Z]{2,4}$/.test(w) && !['RED', 'CELL'].includes(w) ? w : i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(' ')

const ADVICE_COLOR: Record<Advice, string> = { go: STATUS_COLOR.normal, caution: STATUS_COLOR.warning, shelter: STATUS_COLOR.critical }

// ---- radiation decision -----------------------------------------------------------------------
/** Top view of the inner solar system: Earth at the bottom, west (the direction planets move) to the right. */
function ConnectionDiagram({ a }: { a: RadiationAssessment }) {
  const c = 120
  const S = 62
  const at = (lonDeg: number, r: number) => {
    const th = ((lonDeg - 90) * Math.PI) / 180
    return [c + r * S * Math.cos(th), c - r * S * Math.sin(th)] as const
  }
  const spiral = (lonDeg: number, r: number, foot: number) => {
    const pts: string[] = []
    for (let i = 0; i <= 24; i++) {
      const f = i / 24
      const [x, y] = at(foot + (lonDeg - foot) * f, r * f)
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return pts.join(' ')
  }
  const [ex, ey] = at(0, 1)
  const [mx, my] = at(a.geo.lonDeg, a.geo.rAu)
  const src = a.source ? at(a.source.lonDeg, 0.55) : null
  return (
    <svg viewBox="0 0 240 240" className="mx-auto w-full max-w-[250px]" role="img" aria-label={`Sun, Earth and Mars seen from above. Mars is ${Math.round(Math.abs(a.geo.lonDeg))} degrees ${a.geo.lonDeg >= 0 ? 'west' : 'east'} of the Earth–Sun line. Curved lines are the magnetic field lines that guide solar particles to each planet.`}>
      <circle cx={c} cy={c} r={S} fill="none" stroke="rgba(255,255,255,.12)" />
      <circle cx={c} cy={c} r={a.geo.rAu * S} fill="none" stroke="rgba(255,255,255,.12)" strokeDasharray="2 3" />
      <polyline points={spiral(0, 1, a.geo.footEarthDeg)} fill="none" stroke="#7fd8ff" strokeWidth="1.3" opacity=".8" />
      <polyline points={spiral(a.geo.lonDeg, a.geo.rAu, a.geo.footMarsDeg)} fill="none" stroke="#ff6a1f" strokeWidth="1.3" opacity=".9" />
      {src && <line x1={c} y1={c} x2={src[0]} y2={src[1]} stroke="#f2b04c" strokeWidth="2" strokeLinecap="round" />}
      <circle cx={c} cy={c} r="7" fill="#f2b04c" style={{ filter: 'drop-shadow(0 0 8px #f2b04c)' }} />
      <circle cx={ex} cy={ey} r="4.5" fill="#7fd8ff" />
      <circle cx={mx} cy={my} r="4.5" fill="#ff6a1f" />
      <text x={ex + 8} y={ey + 3} fill="#a8978a" fontSize="9" fontFamily="IBM Plex Mono">Earth · GOES</text>
      <text x={mx + 8} y={my + 3} fill="#a8978a" fontSize="9" fontFamily="IBM Plex Mono">Mars</text>
      {src && <text x={src[0] + 5} y={src[1] - 4} fill="#f2b04c" fontSize="9" fontFamily="IBM Plex Mono">eruption</text>}
    </svg>
  )
}

const hoursFrom = (now: number, t: number) => Math.max(0, (t - now) / 3_600_000)

export function RadiationDecisionCard({ className }: { className?: string }) {
  const now = useNow(60_000)
  const dose = useTelemetrySelect((s) => s.latest?.radiation ?? 0)
  const eva = useTelemetrySelect((s) => s.latest?.evaActive ?? false)
  const live = useSyncExternalStore(nasaLive.subscribe, nasaLive.get)
  const [exampleId, setExampleId] = useState<string>('live')
  // both the live mode and the NASA-data simulation load the real GOES and DONKI feeds
  const mode = useDataMode()
  const nasa = mode === 'nasa' || mode === 'live'
  const example = EXAMPLES.find((e) => e.id === exampleId)
  // the same rule as the telemetry sources: only a current measurement counts
  const latest = nasa ? currentProtons(live.protons, now) : null
  const noProtonData = nasa && live.ready && !latest

  const a = useMemo(() => {
    if (example) return assessRadiation({ t: now, doseMSv: dose, eva, ...example.build(now) })
    return assessRadiation({ t: now, doseMSv: dose, eva, p10: latest?.p10 ?? 0, p100: latest?.p100 ?? null, cmes: nasa ? (live.cmes?.data ?? []) : [], noProtonData })
    // dose changes every second; the advice only needs it to 2 decimals
  }, [example, now, Math.round(dose * 100), eva, nasa, latest?.p10, latest?.p100, noProtonData, live.cmes]) // eslint-disable-line react-hooks/exhaustive-deps

  const inputs = example ? example.build(now) : { p10: latest?.p10 ?? 0, p100: latest?.p100 ?? null }
  const color = ADVICE_COLOR[a.advice]
  const pct = (v: number) => (v < 0.01 ? '< 1 %' : `${formatNumber(v * 100, 0)} %`)
  const ratio = (v: number) => (v >= 10 ? formatNumber(v, 0) : v >= 0.1 ? formatNumber(v, 2) : v.toExponential(1))

  return (
    <Card
      className={className}
      title="Radiation: EVA decision"
      method={
        <>
          GOES measures protons in Earth orbit. The flux is carried to Mars with a radial law r^−{RAD.alpha} and a {RAD.sigmaDeg}° Gaussian in magnetic-connection angle to the CME-driven shock (Parker spiral), cut at {RAD.cutoffMeV} MeV by the {RAD.columnGcm2} g/cm² atmosphere using the measured high-energy spectral index, then converted to dose. On the one event measured on Mars (Sept 2017) this estimate was about {RAD.transportUncertainty}× too low, so the upper bound is {RAD.transportUncertainty}× the estimate and decisions use the upper bound. Action levels of {ACTION.cautionMSv} and {ACTION.shelterMSv} mSv per {ACTION.evaHours}-h EVA are this app’s choices. Not dosimetry; full chain on the Methods tab, hindcast on the Evidence tab.
        </>
      }
      sources={[SRC.goes, SRC.donki, SRC.lario, SRC.richardson, SRC.rad, SRC.dbm, SRC.std3001]}
    >
      <div className="rounded-xl p-3.5" role="status" style={{ border: `1px solid ${color}88`, background: 'rgba(0,0,0,.28)' }}>
        <div className="label" style={{ color }}>{a.advice === 'go' ? 'nominal' : a.advice === 'caution' ? 'caution' : 'take shelter'}</div>
        <div className="display mt-1 text-[24px] leading-tight">{a.headline}</div>
        <ul className="mt-2 grid gap-1 text-[13px]" style={{ color: 'var(--ink)', opacity: 0.9 }}>
          {a.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      <label className="grid gap-1.5">
        <span className="label">Inputs</span>
        <select value={exampleId} onChange={(e) => setExampleId(e.target.value)} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'rgba(0,0,0,.35)', border: '1px solid var(--hair)', color: 'var(--ink)' }}>
          <option value="live">{nasa ? 'Live: GOES + DONKI now' : 'No live feed in this data mode (quiet Sun assumed)'}</option>
          {EXAMPLES.map((e) => (
            <option key={e.id} value={e.id}>
              Example: {e.label}
            </option>
          ))}
        </select>
        {example && (
          <span className="text-[12px]" style={{ color: STATUS_COLOR.warning }}>
            {example.note} Not live data.
          </span>
        )}
      </label>

      <ConnectionDiagram a={a} />

      <table className="w-full text-[12.5px]" style={{ color: 'var(--ink)' }}>
        <tbody>
          <tr style={{ borderTop: '1px solid var(--hair)' }}>
            <td className="py-1.5 pr-3" style={{ color: 'var(--taupe)' }}>GOES at Earth</td>
            <td className={td}>{!example && nasa && !latest ? <span style={{ color: STATUS_COLOR.warning }}>{live.ready ? 'no current measurement' : 'loading…'}</span> : <>≥10 MeV {formatNumber(inputs.p10, 2)} pfu · ≥100 MeV {inputs.p100 === null ? '—' : formatNumber(inputs.p100, 2)} pfu</>}{a.eventAtEarth ? ` · spectral index ${formatNumber(a.gamma, 2)} (${a.gammaFrom === 'tail' ? 'measured ≥100/≥500 MeV tail' : '10–100 MeV, conservative'})` : ' · no event'}</td>
          </tr>
          <tr style={{ borderTop: '1px solid var(--hair)' }}>
            <td className="py-1.5 pr-3" style={{ color: 'var(--taupe)' }}>Mars today</td>
            <td className={td}>
              {formatNumber(a.geo.rAu, 2)} au from the Sun, {formatNumber(Math.abs(a.geo.lonDeg), 0)}° {a.geo.lonDeg >= 0 ? 'west' : 'east'} of Earth
            </td>
          </tr>
          <tr style={{ borderTop: '1px solid var(--hair)' }}>
            <td className="py-1.5 pr-3" style={{ color: 'var(--taupe)' }}>Earth → Mars</td>
            <td className={td}>
              distance × {formatNumber(a.scaling.radial, 2)}
              {a.source ? (
                <>
                  {' '}· connection × {ratio(a.scaling.longitudinal)} (source {formatNumber(a.scaling.deltaEarthDeg ?? NaN, 0)}° from Earth’s field line, {formatNumber(a.scaling.deltaMarsDeg ?? NaN, 0)}° from Mars’)
                </>
              ) : (
                ' · no recent eruption to locate the source'
              )}
              {' '}→ flux × <b>{ratio(a.scaling.ratio)}</b>
              {a.scaling.unreliable && <span style={{ color: STATUS_COLOR.warning }}> (capped: GOES is poorly placed for this event)</span>}
            </td>
          </tr>
          <tr style={{ borderTop: '1px solid var(--hair)' }}>
            <td className="py-1.5 pr-3 align-top" style={{ color: 'var(--taupe)' }}>Surface dose rate</td>
            <td className={td}>
              background {formatNumber(a.gcrUSvH, 0)} µSv/h (cosmic rays)
              {a.eventAtEarth && (
                <>
                  {' '}+ solar protons:
                  {(Object.keys(SHIELDS) as ShieldId[]).map((id) => (
                    <span key={id} className="block">
                      {SHIELDS[id].label} ({SHIELDS[id].gcm2} g/cm²): <b>{formatNumber(a.sep[id], a.sep[id] < 10 ? 1 : 0)}</b> µSv/h
                      {id === 'suit' && <span style={{ color: 'var(--taupe)' }}> (upper bound {formatNumber(a.sepSuitRange[1], 0)})</span>}
                    </span>
                  ))}
                </>
              )}
            </td>
          </tr>
          <tr style={{ borderTop: '1px solid var(--hair)' }}>
            <td className="py-1.5 pr-3 align-top" style={{ color: 'var(--taupe)' }}>CMEs toward Mars</td>
            <td className={td}>
              {a.cmes.length === 0
                ? 'none in transit'
                : a.cmes.slice(0, 3).map((f) => (
                    <span key={f.cme.id} className="block">
                      {f.cme.url ? (
                        <a href={f.cme.url} target="_blank" rel="noreferrer" style={linkStyle}>
                          {formatNumber(f.cme.speedKmS, 0)} km/s
                        </a>
                      ) : (
                        `${formatNumber(f.cme.speedKmS, 0)} km/s`
                      )}
                      , arrives in {formatNumber(hoursFrom(now, f.arrivalEarliest), 0)}–{formatNumber(hoursFrom(now, f.arrivalLatest), 0)} h at about {formatNumber(f.arrivalSpeedKmS, 0)} km/s
                    </span>
                  ))}
            </td>
          </tr>
          <tr style={{ borderTop: '1px solid var(--hair)' }}>
            <td className="py-1.5 pr-3" style={{ color: 'var(--taupe)' }}>Career budget</td>
            <td className={td}>
              {formatNumber(dose, 3)} mSv = {formatNumber(a.careerUsedPct, 2)} % of NASA’s {CAREER_LIMIT_MSV} mSv limit
            </td>
          </tr>
        </tbody>
      </table>
      <Note>
        The suit passes {pct(Math.pow((RAD.columnGcm2 + SHIELDS.suit.gcm2) / RAD.columnGcm2, -a.gamma / RAD.braggP))} of what the atmosphere lets through: on Mars the {RAD.columnGcm2} g/cm² of CO₂ overhead is the shield, the suit is not. Only protons above about {RAD.cutoffMeV} MeV reach the ground, which is why the ≥100 MeV channel is used rather than the ≥10 MeV channel of the NOAA storm scale.
      </Note>
    </Card>
  )
}

// ---- personal baseline -------------------------------------------------------------------------
export function BaselineCard({ className }: { className?: string }) {
  const b = useTelemetrySelect((s) => s.science.baseline)
  const statuses = useTelemetrySelect((s) => s.statuses)
  const o = osdrAnalysis()
  return (
    <Card
      className={className}
      title="Personal baseline"
      method={
        <>
          z = (mean of the last {BASELINE.smoothS} s − μ) / σ against this crew member’s own exponentially weighted norm (half-life {BASELINE.halfLifeS} s), kept separately for rest and EVA and saved per account. A deviation is |z| ≥ {BASELINE.zLimit} for {BASELINE.persistS} s. Why personal: in the Inspiration4 crew’s blood panels {formatNumber(o.lowIiShare * 100, 0)} % of analytes have an index of individuality below 0.6, where a population range is insensitive for an individual.
        </>
      }
      sources={[SRC.harris, SRC.montgomery, SRC.osd569, SRC.osd575]}
    >
      {!b ? (
        <Note>Waiting for telemetry…</Note>
      ) : (
        <div className="grid gap-2.5">
          {BASELINE_KEYS.map((k) => {
            const r = b[k]
            const c = METRICS[k]
            const z = Number.isFinite(r.z) ? Math.max(-6, Math.min(6, r.z)) : 0
            const color = r.deviating ? STATUS_COLOR.warning : STATUS_COLOR.normal
            const insideBand = statuses[k] === 'normal'
            return (
              <div key={k}>
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span>{c.label}</span>
                  <span className="num text-[12px]" style={{ color: 'var(--taupe)' }}>
                    {r.ready ? (
                      <>
                        norm {formatNumber(r.mean, c.decimals)} ± {formatNumber(r.sd, c.decimals + 1)} {c.unit} ({r.activity === 'eva' ? 'EVA' : 'rest'}) · <b style={{ color: r.deviating ? color : 'var(--ink)' }}>{Number.isFinite(r.z) ? `${r.z >= 0 ? '+' : ''}${formatNumber(r.z, 1)} σ` : '—'}</b>
                      </>
                    ) : (
                      'learning your norm…'
                    )}
                  </span>
                </div>
                <div className="relative mt-1 h-[6px] rounded-full" style={{ background: 'rgba(255,255,255,.1)' }} aria-hidden="true">
                  <div className="absolute inset-y-0 w-px" style={{ left: '50%', background: 'rgba(255,255,255,.35)' }} />
                  {[-1, 1].map((sgn) => (
                    <div key={sgn} className="absolute -top-0.5 h-[10px] w-px" style={{ left: `${50 + (sgn * BASELINE.zLimit * 50) / 6}%`, background: STATUS_COLOR.warning, opacity: 0.7 }} />
                  ))}
                  {r.ready && Number.isFinite(r.z) && <div className="absolute -top-[3px] h-3 w-3 -translate-x-1/2 rounded-full" style={{ left: `${50 + (z * 50) / 6}%`, background: color, transition: 'left .6s' }} />}
                </div>
                {r.deviating && (
                  <p className="mt-1 text-[12px]" style={{ color }}>
                    {r.direction === 'high' ? 'Above' : 'Below'} your {r.activity === 'eva' ? 'EVA' : 'resting'} norm for {formatNumber(r.forS, 0)} s{insideBand ? ' — still inside the fixed safe range, so an ordinary monitor shows nothing.' : '.'}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ---- joint deviation ----------------------------------------------------------------------------
const JOINT_LABEL = ['HR', 'SpO₂', 'Temp', 'Resp', 'Suit']

export function JointCard({ className }: { className?: string }) {
  const j = useTelemetrySelect((s) => s.science.joint)
  const ready = !!j && Number.isFinite(j.t2)
  const color = j?.flagged ? STATUS_COLOR.warning : STATUS_COLOR.normal
  return (
    <Card
      className={className}
      title="Joint deviation"
      method={
        <>
          T² = Σ z² over the personal z-scores of {JOINT_KEYS.length} vitals (diagonal Hotelling T²). Reported when T² ≥ {JOINT.limit} for {JOINT.persistS} s; the limit is tuned on undisturbed runs, not taken from the χ² table, because the vitals are correlated in time. The pattern name comes from the direction of the z-vector (cosine similarity ≥ {JOINT.minSimilarity} with a signature written by this app from textbook physiology): a pointer, not a diagnosis.
        </>
      }
      sources={[SRC.hotelling]}
    >
      {!ready ? (
        <Note>Needs at least {JOINT.minVitals} vitals with a learned norm…</Note>
      ) : (
        <>
          <div className="flex items-end justify-between">
            <Big value={formatNumber(j.t2, 1)} unit={`T² · limit ${JOINT.limit}`} color={color} size={38} />
            <span className="label" style={{ color }}>{j.flagged ? 'vitals moving together' : 'nothing unusual'}</span>
          </div>
          <div className="relative h-[6px] rounded-full" style={{ background: 'rgba(255,255,255,.1)' }} aria-hidden="true">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (j.t2 / (JOINT.limit * 2)) * 100)}%`, background: color, transition: 'width .6s' }} />
            <div className="absolute -top-1 h-[14px] w-px" style={{ left: '50%', background: STATUS_COLOR.warning }} />
          </div>
          <div className="flex gap-1.5" aria-label="z-score of each vital">
            {j.z.map((z, i) => (
              <div key={JOINT_LABEL[i]} className="flex-1 rounded-lg px-1 py-1.5 text-center" style={{ border: '1px solid var(--hair)', background: 'rgba(0,0,0,.25)', opacity: i < JOINT_KEYS.length ? 1 : 0.55 }}>
                <div className="label">{JOINT_LABEL[i]}</div>
                <div className="num text-[13px]" style={{ color: Math.abs(z) >= 2 ? STATUS_COLOR.warning : 'var(--ink)' }}>{z >= 0 ? '+' : ''}{formatNumber(z, 1)}</div>
              </div>
            ))}
          </div>
          {j.flagged && (
            <Note>
              {j.match ? (
                <>
                  <b style={{ color }}>{j.match.signature.label}</b> (similarity {formatNumber(j.match.similarity, 2)}). {j.match.signature.why} {j.match.signature.act}
                </>
              ) : (
                <>Several vitals are away from your norm together, in a combination that matches none of the stored patterns. Re-check in a minute and tell a crewmate how you feel.</>
              )}
            </Note>
          )}
        </>
      )}
    </Card>
  )
}

// ---- hindcast ------------------------------------------------------------------------------------
export function HindcastCard({ className }: { className?: string }) {
  const h = hindcast()
  const d = SEP2017
  const max = Math.max(...d.series.map((p) => p[1]))
  const W = 300
  const H = 70
  const t0 = d.series[0][0]
  const t1 = d.series[d.series.length - 1][0]
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W
  const y = (v: number) => H - (Math.log10(Math.max(v, 0.03) / 0.03) / Math.log10(max / 0.03)) * (H - 4)
  const fmt = (v: number) => (v >= 10 ? formatNumber(v, 0) : v >= 1 ? formatNumber(v, 1) : v >= 0.1 ? formatNumber(v, 2) : formatNumber(v, 3))
  const cur = h.rows[2]
  return (
    <Card
      className={className}
      title="Radiation model against a real event"
      method={
        <>
          10 September 2017: X8.2 flare and a {d.cme.speedKmS} km/s CME. Inputs: GOES-15 peak fluxes from NOAA NCEI, background-subtracted (≥10 MeV {formatNumber(h.net.p10, 0)}, ≥100 MeV {formatNumber(h.net.p100, 1)}, ≥510 MeV {formatNumber(h.net.p510, 2)} pfu), CME direction and width from DONKI. Observation: RAD’s dose rate rose to {RAD_OBSERVED.peakFactor[0]}–{RAD_OBSERVED.peakFactor[1]} times the {RAD_OBSERVED.backgroundUGyDay} µGy/day background. Peak dose rate only; the model has no timing (RAD peaked 6–16 h after GOES). One event, and the model was revised after seeing it, so the upper bound is a calibration, not an independent validation; the 2021 and 2024 events would be the independent tests. Rebuild with <code>npm run fetch:hindcast</code>.
        </>
      }
      sources={[SRC.zeitlin, SRC.ncei, SRC.donki, SRC.bruno]}
    >
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="label">Measured on Mars</div>
          <Big value={`${formatNumber(h.observed[0], 0)}–${formatNumber(h.observed[1], 0)}`} unit="µGy/h" size={34} />
          <div className="text-[12px]" style={{ color: 'var(--taupe)' }}>above background, MSL-RAD</div>
        </div>
        <div>
          <div className="label">Model, from GOES at Earth</div>
          <Big value={fmt(cur.predicted)} unit="µGy/h" size={34} />
          <div className="text-[12px]" style={{ color: 'var(--taupe)' }}>upper bound {fmt(cur.high)}; first version {fmt(h.rows[0].predicted)}</div>
        </div>
        <div>
          <div className="label">Model error</div>
          <Big value={`${formatNumber(cur.observedOverPredicted, 0)}×`} unit="too low" size={34} color={STATUS_COLOR.warning} />
          <div className="text-[12px]" style={{ color: 'var(--taupe)' }}>was {formatNumber(h.rows[0].observedOverPredicted, 0)}× before the revision</div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full" role="img" aria-label={`GOES-15 proton flux above 100 MeV at Earth from 10 to 12 September 2017, rising from background to ${formatNumber(max, 0)} pfu within a few hours and decaying over two days.`}>
        <polyline points={d.series.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')} fill="none" stroke="#7fd8ff" strokeWidth="1.5" />
        <line x1={x(h.peakTime)} x2={x(h.peakTime)} y1="0" y2={H} stroke="rgba(255,255,255,.25)" strokeDasharray="2 3" />
        <text x={Math.min(W - 96, x(h.peakTime) + 4)} y="9" fill="#a8978a" fontSize="8" fontFamily="IBM Plex Mono">GOES ≥100 MeV peak {formatNumber(max, 0)} pfu</text>
        {[0, 1, 2].map((dy) => (
          <text key={dy} x={x(Date.UTC(2017, 8, 11 + dy) - (dy === 2 ? 3_600_000 : 0))} y={H + 11} fill="#a8978a" fontSize="8" fontFamily="IBM Plex Mono" textAnchor={dy === 2 ? 'end' : 'middle'}>{11 + dy} Sep</text>
        ))}
      </svg>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]" style={{ color: 'var(--ink)' }}>
          <thead>
            <tr>
              <th className={th}>Model version</th>
              <th className={th}>Earth → Mars flux</th>
              <th className={th}>Predicted</th>
              <th className={th}>Error</th>
              <th className={th}>Advice</th>
            </tr>
          </thead>
          <tbody>
            {h.rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--hair)' }}>
                <td className="py-1.5 pr-3">{r.label}</td>
                <td className={td}>× {r.ratio.toExponential(1)}</td>
                <td className={td}>{fmt(r.predicted)} <span style={{ color: 'var(--taupe)' }}>({fmt(r.low)}–{fmt(r.high)})</span></td>
                <td className={td}>{formatNumber(r.observedOverPredicted, 0)}× low</td>
                <td className={td} style={{ color: ADVICE_COLOR[r.advice] }}>{r.advice}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Note>
        Mars was {formatNumber(h.marsLonDeg, 0)}° from Earth in longitude at {formatNumber(h.marsAu, 2)} au, with its field line {formatNumber(h.deltaMarsDeg, 0)}° beyond the edge of the CME. The first version measured that angle from a single point and predicted almost nothing: it would have cleared an EVA during the largest event RAD had seen. Treating the whole CME-driven shock as the source closes most of the gap; a steeper measured spectrum alone made it worse. What remains ({formatNumber(cur.observedOverPredicted, 0)}×) is why every estimate now carries a {RAD.transportUncertainty}× upper bound and the decision uses it. With that bound the model says “{cur.advice}”; an 8-hour EVA at the measured peak would have received {formatNumber(h.observedEvaMSv[0], 2)}–{formatNumber(h.observedEvaMSv[1], 2)} mSv, at the {ACTION.cautionMSv} mSv caution level.
      </Note>
    </Card>
  )
}

// ---- OSDR evidence -----------------------------------------------------------------------------
export function OsdrCard({ className }: { className?: string }) {
  const o = osdrAnalysis()
  const [all, setAll] = useState(false)
  const rows = all ? o.analytes : o.analytes.slice(0, 8)
  const r1flags = o.flags.filter((f) => f.timepoint === 'R+1' && f.personal)
  const share = (n: number, d: number) => `${formatNumber((n / d) * 100, 1)} %`
  return (
    <Card
      className={className}
      title="Real astronaut data: why a personal baseline"
      method={
        <>
          Inspiration4 crew (4 people), clinical blood panels from NASA OSDR: 3 pre-flight draws (L-92, L-44, L-3) and 4 after landing. One-way ANOVA on the pre-flight draws gives within-person (CV_I, includes analytical variation) and between-person (CV_G) variation; index of individuality II = CV_I / CV_G. A post-flight value is a personal deviation when it leaves the 95 % prediction interval of that person’s pre-flight values, and a population deviation when it leaves the laboratory range. Excluded: {EXCLUDED_DRAWS.map((d) => `${d.panel} ${d.subject} ${d.timepoint} (${d.reason})`).join('; ')}. Four people support the approach; they do not define clinical norms.
        </>
      }
      sources={[SRC.osd569, SRC.osd575, SRC.harris, SRC.fraser]}
    >
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="label">Analytes with II &lt; 0.6</div>
          <Big value={formatNumber(o.lowIiShare * 100, 0)} unit="%" size={38} />
          <div className="text-[12px]" style={{ color: 'var(--taupe)' }}>of {o.analytes.length}; median II {formatNumber(o.medianIi, 2)}</div>
        </div>
        <div>
          <div className="label">Day after landing (R+1)</div>
          <Big value={`${o.r1.personal} vs ${o.r1.population}`} size={38} />
          <div className="text-[12px]" style={{ color: 'var(--taupe)' }}>changes flagged by personal vs population yardstick, of {o.r1.n}; {o.r1.both} in common</div>
        </div>
        <div>
          <div className="label">False flags before flight</div>
          <Big value={`${share(o.preflight.personal, o.preflight.n)} vs ${share(o.preflight.population, o.preflight.n)}`} size={26} />
          <div className="text-[12px]" style={{ color: 'var(--taupe)' }}>personal (leave-one-out) vs population, {o.preflight.n} healthy pre-flight values</div>
        </div>
      </div>
      <Note>
        The two yardsticks see different things. The population range mostly flags people whose healthy normal sits near a range edge; the personal baseline flags changes after flight that stay inside the range — {r1flags.map((f) => `${analyteName(f.analyte).replace(', total', '')} in ${f.subject} (${f.z > 0 ? '+' : ''}${formatNumber(f.z, 1)} σ)`).join(', ')}.
      </Note>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]" style={{ color: 'var(--ink)' }}>
          <thead>
            <tr>
              <th className={th}>Analyte</th>
              <th className={th}>Within person CV</th>
              <th className={th}>Between people CV</th>
              <th className={th}>II</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.panel + x.analyte} style={{ borderTop: '1px solid var(--hair)' }}>
                <td className="py-1.5 pr-3">{analyteName(x.analyte)} <span style={{ color: 'var(--taupe)' }}>· {x.panel}</span></td>
                <td className={td}>{formatNumber(x.cvI, 1)} %</td>
                <td className={td}>{formatNumber(x.cvG, 1)} %</td>
                <td className={td} style={{ color: x.ii < 0.6 ? STATUS_COLOR.normal : x.ii > 1.4 ? 'var(--taupe)' : 'var(--ink)' }}>{formatNumber(x.ii, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => setAll((v) => !v)} className="label justify-self-start rounded-lg px-3 py-2" style={{ background: 'rgba(0,0,0,.3)', border: '1px solid var(--hair)', color: 'var(--ink)', cursor: 'pointer' }}>
        {all ? 'Show fewer' : `Show all ${o.analytes.length} analytes`}
      </button>
      <p className="text-[11.5px]" style={{ color: 'var(--taupe)' }}>
        Data files (SHA-256):{' '}
        {o.sources.map((s, i) => (
          <span key={s.file}>
            {i > 0 && '; '}
            <a href={s.url} target="_blank" rel="noreferrer" style={linkStyle}>{s.study} {s.panel}</a> <span className="num">{s.sha256.slice(0, 12)}…</span>
          </span>
        ))}
        . Refresh with <code>npm run fetch:osdr</code>.
      </p>
    </Card>
  )
}

// ---- validation --------------------------------------------------------------------------------
const FAMILY_LABEL: Record<Family, { name: string; what: string }> = {
  abrupt: { name: 'Abrupt', what: 'jump to warning level, 60 s' },
  gradual: { name: 'Gradual', what: 'drift to warning level over 120 s' },
  subthreshold: { name: 'Inside the safe band', what: 'shift that never leaves the fixed range, 120 s' },
  pattern: { name: 'Three small shifts together', what: 'low-oxygen pattern: SpO₂ −1.3 %, heart rate +8, respiration +1.6, 120 s' },
}
const DETECTOR_LABEL: Record<Detector, string> = { fixed: 'Fixed band', personal: 'Personal baseline', joint: 'Joint (T²)', trend: 'Trend forecast' }

export function ValidationCard({ className }: { className?: string }) {
  const [report, setReport] = useState<ValidationReport>(stored.report as ValidationReport)
  const [origin, setOrigin] = useState(`stored run of ${stored.generated}`)
  const [progress, setProgress] = useState<number | null>(null)
  const [perVital, setPerVital] = useState(false)
  const cancelled = useRef(false)

  const run = async () => {
    cancelled.current = false
    const seedBase = 2000 + Math.floor(Math.random() * 1_000_000)
    const plan = validationPlan(report.runsPerCell, seedBase)
    const quietRuns = 20
    const total = plan.length + quietRuns
    const results: RunResult[] = []
    const quiet: FalseAlarmResult[] = []
    const pause = () => new Promise((r) => setTimeout(r, 0))
    setProgress(0)
    for (let i = 0; i < plan.length; i++) {
      results.push(runScenario(plan[i]))
      if (i % 4 === 3) {
        setProgress((i + 1) / total)
        await pause()
        if (cancelled.current) return setProgress(null)
      }
    }
    for (let i = 0; i < quietRuns; i++) {
      quiet.push(runQuiet(seedBase + 100_000 + i))
      setProgress((plan.length + i + 1) / total)
      await pause()
      if (cancelled.current) return setProgress(null)
    }
    setReport(summarise(results, quiet, report.runsPerCell, seedBase))
    setOrigin(`run in this browser just now, seeds ${seedBase}…`)
    setProgress(null)
  }

  const find = (family: Family, key: string, d: Detector) => report.cells.find((c) => c.family === family && c.key === key && c.detector === d)
  const cell = (family: Family, key: string, d: Detector) => find(family, key, d)!
  const sec = (v: number | null) => (v === null ? '—' : `${formatNumber(v, 0)} s`)
  const keys = perVital ? (['all', ...VALIDATION_KEYS] as const) : (['all'] as const)
  const personalSub = cell('subthreshold', 'all', 'personal')
  const fixedSub = cell('subthreshold', 'all', 'fixed')
  const jointPat = cell('pattern', 'all', 'joint')
  const personalPat = cell('pattern', 'all', 'personal')
  const pctCi = (c: { rate: number; ciLow: number; ciHigh: number }) => `${formatNumber(c.rate * 100, 0)} %`
  const fa = (d: Detector) => report.falseAlarms.find((f) => f.detector === d)!

  return (
    <Card
      className={className}
      title="Measured detection performance"
      method={
        <>
          Each run drives the seeded simulator through the same store and detectors as the live dashboard, with 10 min of prior data, injects one disturbance at a known time and records the first report. {report.runsPerCell * 4} runs per disturbance type ({report.runsPerCell * 4 * FAMILIES.length} runs), plus {report.quietRuns} undisturbed 30-min runs for false alarms. Brackets are 95 % Wilson score intervals. Detector settings were tuned on other seeds than the ones reported. The stream is simulated: these are properties of the algorithms on this signal model, not clinical sensitivity. Reproduce with <code>npm run validate</code>.
        </>
      }
      sources={[]}
    >
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div>
          <div className="label">Changes inside the safe band caught</div>
          <Big value={`${pctCi(personalSub)} vs ${pctCi(fixedSub)}`} size={26} />
          <div className="text-[12px]" style={{ color: 'var(--taupe)' }}>personal baseline vs fixed band</div>
        </div>
        <div>
          <div className="label">Three small shifts together caught</div>
          <Big value={`${pctCi(jointPat)} vs ${pctCi(personalPat)}`} size={26} />
          <div className="text-[12px]" style={{ color: 'var(--taupe)' }}>joint T² vs single-vital baseline; fixed band {pctCi(cell('pattern', 'all', 'fixed'))}</div>
        </div>
        <div>
          <div className="label">Gradual drift: head start</div>
          <Big value={formatNumber(report.leadOverFixedS.gradual ?? NaN, 0)} unit="s" size={38} />
          <div className="text-[12px]" style={{ color: 'var(--taupe)' }}>median, personal baseline before fixed band</div>
        </div>
        <div>
          <div className="label">False alarms per hour</div>
          <Big value={`${formatNumber(fa('personal').perHour, 1)} vs ${formatNumber(fa('fixed').perHour, 1)}`} size={26} />
          <div className="text-[12px]" style={{ color: 'var(--taupe)' }}>personal baseline vs fixed band, {formatNumber(fa('fixed').hours, 0)} h undisturbed</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]" style={{ color: 'var(--ink)' }}>
          <thead>
            <tr>
              <th className={th}>Disturbance</th>
              {DETECTORS.map((d) => (
                <th key={d} className={th} colSpan={2}>{DETECTOR_LABEL[d]}</th>
              ))}
            </tr>
            <tr>
              <th className={th} />
              {DETECTORS.map((d) => [
                <th key={d + 'r'} className={th}>detected</th>,
                <th key={d + 'm'} className={th}>median · p90</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {FAMILIES.map((f) =>
              keys.filter((k) => find(f, k, 'fixed')).map((k) => (
                <tr key={f + k} style={{ borderTop: '1px solid var(--hair)' }}>
                  <td className="py-1.5 pr-3">
                    {k === 'all' ? (
                      <>
                        {FAMILY_LABEL[f].name} <span className="block text-[11.5px]" style={{ color: 'var(--taupe)' }}>{FAMILY_LABEL[f].what}</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--taupe)', paddingLeft: 12 }}>{METRICS[k].label}</span>
                    )}
                  </td>
                  {DETECTORS.map((d) => {
                    const c = cell(f, k, d)
                    return [
                      <td key={d + 'r'} className={td}>
                        {formatNumber(c.rate * 100, 0)} % <span style={{ color: 'var(--taupe)' }}>[{formatNumber(c.ciLow * 100, 0)}–{formatNumber(c.ciHigh * 100, 0)}]</span>
                      </td>,
                      <td key={d + 'm'} className={td}>{c.detected ? `${sec(c.medianS)} · ${sec(c.p90S)}` : '—'}</td>,
                    ]
                  })}
                </tr>
              )),
            )}
            <tr style={{ borderTop: '1px solid var(--hair)' }}>
              <td className="py-1.5 pr-3">
                No disturbance <span className="block text-[11.5px]" style={{ color: 'var(--taupe)' }}>false alarms per hour, all watched vitals together</span>
              </td>
              {DETECTORS.map((d) => (
                <td key={d} className={td} colSpan={2}>{formatNumber(fa(d).perHour, 2)} / h <span style={{ color: 'var(--taupe)' }}>({fa(d).episodes} in {formatNumber(fa(d).hours, 0)} h)</span></td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <Note>
        Read it as a trade-off, not a win: the fixed band is fastest on abrupt events and never false-alarms here, but it is blind to anything that stays inside the range. The personal baseline sees those changes and gets ahead on slow drifts, at the cost of about {formatNumber(fa('personal').perHour, 1)} false alarms per hour. The joint statistic is the only one that reliably sees several small shifts together, with {formatNumber(fa('joint').perHour, 1)} false alarms per hour, but it ignores suit pressure and is slower on single-vital events. The dashboard runs all four.
      </Note>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={progress === null ? run : () => (cancelled.current = true)} className="label rounded-lg px-3 py-2" style={{ background: 'var(--rust)', border: '1px solid var(--hair)', color: 'var(--ink)', cursor: 'pointer' }}>
          {progress === null ? 'Re-run on new random seeds' : `Running… ${formatNumber(progress * 100, 0)} % (stop)`}
        </button>
        <button onClick={() => setPerVital((v) => !v)} className="label rounded-lg px-3 py-2" style={{ background: 'rgba(0,0,0,.3)', border: '1px solid var(--hair)', color: 'var(--ink)', cursor: 'pointer' }}>
          {perVital ? 'Hide per-vital rows' : 'Show per vital'}
        </button>
        <span className="text-[12px]" style={{ color: 'var(--taupe)' }} aria-live="polite">Showing: {origin}</span>
      </div>
    </Card>
  )
}

export function EvidenceView() {
  return (
    <div className="grid grid-cols-12 items-start gap-5">
      <ValidationCard className="col-span-12" />
      <HindcastCard className="col-span-6" />
      <OsdrCard className="col-span-6" />
    </div>
  )
}

// ---- methods -----------------------------------------------------------------------------------
export function MethodsView() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="glass rise p-5 lg:col-span-2">
        <h2 className="display text-[20px]">Methods</h2>
        <p className="mt-2 max-w-[90ch] text-[13px] leading-relaxed" style={{ color: 'var(--ink)', opacity: 0.85 }}>
          Every number on this dashboard that is not a raw reading comes from one of the models below. Each entry gives the formula, the published source of its constants, what this app assumed on top, and how it was checked. Crew vitals are simulated (no public live astronaut telemetry exists); the environment — Mars weather, proton flux, eruptions — and the astronaut blood data are real NASA and NOAA data.
        </p>
      </section>
      {METHODS.map((m) => (
        <section key={m.id} className="glass rise grid min-w-0 content-start gap-2.5 p-5">
          <h3 className="display text-[18px]">{m.name}</h3>
          <p className="text-[13px]" style={{ color: 'var(--ink)', opacity: 0.85 }}>{m.purpose}</p>
          <ul className="grid gap-1.5">
            {m.formulas.map((f) => (
              <li key={f} className="num rounded-lg px-3 py-2 text-[12.5px] leading-relaxed" style={{ background: 'rgba(0,0,0,.3)', border: '1px solid var(--hair)', color: 'var(--ink)', overflowWrap: 'anywhere' }}>
                {f}
              </li>
            ))}
          </ul>
          <dl className="grid gap-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--taupe)' }}>
            <div>
              <dt className="label inline">Sources </dt>
              <dd className="inline"><Sources sources={m.sources} /></dd>
            </div>
            <div>
              <dt className="label inline">App assumptions </dt>
              <dd className="inline">{m.assumptions.join('; ')}.</dd>
            </div>
            <div>
              <dt className="label inline">Checked by </dt>
              <dd className="inline">{m.check}</dd>
            </div>
            <div>
              <dt className="label inline">Code </dt>
              <dd className="num inline">{m.code}</dd>
            </div>
          </dl>
        </section>
      ))}
    </div>
  )
}
