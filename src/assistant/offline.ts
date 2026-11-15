import { METRICS, VITAL_KEYS, type MetricKey } from '../config/thresholds'
import { GUIDE, HAZARDS } from '../config/guidance'
import type { Snapshot } from '../data/store'
import type { NasaLive } from '../data/nasaSource'
import { formatNumber } from '../lib/format'
import { NASA_TR_REFERENCE, earthMarsLink } from '../science/models'

/**
 * Built-in, rule-based answers used when Gemini is not available. Not AI: it matches the question
 * to a topic and answers from the dashboard's own data and guidance texts.
 */

type Snap = Pick<Snapshot, 'latest' | 'statuses' | 'alerts'> & { science?: Snapshot['science'] }
type Env = (Pick<NasaLive, 'ready' | 'storm' | 'p10' | 'doseRateUSvH'> & { rad?: NasaLive['rad'] }) | null | undefined

const TOPICS: { keys: MetricKey[]; words: RegExp }[] = [
  { keys: ['heartRate'], words: /heart|pulse|\bhr\b|bpm|ecg|пульс|сердц/i },
  { keys: ['spo2'], words: /spo2|spo₂|blood oxygen|saturation|кислород в крови|сатурац/i },
  { keys: ['hydration'], words: /hydrat|water|drink|thirst|вод|гидрат|пить/i },
  { keys: ['bodyTemp'], words: /body temp|fever|core temp|overheat|температур[аы] тела|жар/i },
  { keys: ['suitPressure'], words: /suit pressure|pressure|leak|psi|давлени/i },
  { keys: ['o2Tank'], words: /o2|o₂|oxygen tank|oxygen reserve|баллон|запас кислород/i },
  { keys: ['battery'], words: /battery|power|батаре|заряд/i },
  { keys: ['outsideTemp', 'visorTemp', 'gloveTemp', 'bootTemp'], words: /outside|weather|cold|mars temp|снаружи|погод|холод/i },
]

const fmt = (s: NonNullable<Snap['latest']>, k: MetricKey) => `${formatNumber(s[k], METRICS[k].decimals)} ${METRICS[k].unit}`

function metricAnswer(snap: Snap, k: MetricKey): string {
  const s = snap.latest!
  const c = METRICS[k]
  const st = snap.statuses[k]
  const g = GUIDE[k]
  if (!Number.isFinite(s[k])) return `${c.label} is not being measured right now, so there is no value to assess. ${g ? g.what : ''} No instrument is connected for it in this mode.`.replace(/\s+/g, ' ')
  const parts = [`${c.label} is ${fmt(s, k)} — ${st}.`]
  if (g) parts.push(g.what, g.why)
  if (g && st !== 'normal') parts.push(`What to do: ${g.act[st]}`)
  return parts.join(' ')
}

function statusAnswer(snap: Snap): string {
  const s = snap.latest!
  const off = VITAL_KEYS.filter((k) => snap.statuses[k] !== 'normal')
  const names: [MetricKey, string][] = [['heartRate', 'Heart rate'], ['spo2', 'SpO₂'], ['hydration', 'hydration'], ['bodyTemp', 'body temperature'], ['suitPressure', 'suit pressure']]
  const known = names.filter(([k]) => Number.isFinite(s[k]))
  const missing = names.filter(([k]) => !Number.isFinite(s[k]))
  if (!known.length) return 'No body or suit instrument is connected in live mode, so I cannot assess your state. Mars weather and radiation are available; the training simulation shows the full dashboard.'
  const vitals = `${known.map(([k, n]) => `${n} ${fmt(s, k)}`).join(', ')}.${missing.length ? ` Not measured: ${missing.map(([, n]) => n.toLowerCase()).join(', ')}.` : ''}`
  const head = off.length ? `Attention needed: ${off.map((k) => `${METRICS[k].label.toLowerCase()} is ${snap.statuses[k]}`).join(', ')}.` : missing.length ? 'Everything being measured is in the safe range.' : 'All monitored vitals are in the safe range.'
  // a traverse (distance to go, ETA) exists only in the simulation
  const activity = Number.isFinite(s.etaMin) ? (s.evaActive ? `EVA in progress, ${formatNumber(s.distanceKm, 1)} km to go, about ${s.etaMin} min.` : 'The crew member is resting.') : s.evaActive ? 'You are on the move.' : ''
  return `${head} ${vitals} ${activity}`.trim()
}

function alertAnswer(snap: Snap): string {
  const open = snap.alerts.filter((a) => a.resolvedAt === undefined)
  if (!open.length) {
    const last = snap.alerts[0]
    return last ? `No active alerts. The last one was ${METRICS[last.key].label.toLowerCase()} (${last.level}), now ${last.outcome ?? 'closed'}.` : 'No active alerts. Nothing to act on right now.'
  }
  return open
    .map((a) => {
      const g = GUIDE[a.key]
      return `${METRICS[a.key].label} ${a.level} (${formatNumber(a.value, METRICS[a.key].decimals)} ${METRICS[a.key].unit}): ${g ? g.act[a.level] : 'follow the checklist and tell the flight surgeon.'}`
    })
    .join('\n')
}

function radiationAnswer(snap: Snap, env: Env): string {
  const s = snap.latest!
  const g = GUIDE.radiation!
  const parts = [`Accumulated dose is ${fmt(s, 'radiation')} (${snap.statuses.radiation}; warning above ${METRICS.radiation.warn.high} mSv, critical above ${METRICS.radiation.crit.high} mSv).`]
  if (env?.ready) parts.push(`Space weather: proton flux ${env.p10.toFixed(2)} pfu, NOAA storm level ${env.storm}; modelled dose rate ${env.doseRateUSvH.toFixed(1)} µSv/h, mostly galactic cosmic rays.`)
  parts.push(g.why, g.hazard)
  if (snap.statuses.radiation !== 'normal') parts.push(`What to do: ${g.act[snap.statuses.radiation as 'warning' | 'critical']}`)
  return parts.join(' ')
}

const HELP = 'I can answer from the dashboard: the crew’s overall status, what to do about an alert, radiation and space weather, a specific vital (heart rate, SpO₂, hydration, body temperature, suit pressure, O₂, battery), outside conditions, or spaceflight hazards.'

export function offlineAnswer(question: string, snap: Snap, env?: Env): string {
  const q = question.toLowerCase()
  if (!snap.latest) return 'No telemetry has arrived yet, so there is nothing to report. Try again in a few seconds.'
  if (/alert|warning|critical|what (should|do) i do|do now|problem|тревог|что делать/i.test(q)) return alertAnswer(snap)
  if (/delay|earth|ground|signal|comms?|communicat|latency|задержк|связ|земл/i.test(q)) {
    const l = earthMarsLink(snap.latest.t)
    return `Mars is ${formatNumber(l.distanceKm / 1e6, 0)} million km from Earth today, so a radio signal needs ${formatNumber(l.oneWayS / 60, 1)} min one way and ${formatNumber((2 * l.oneWayS) / 60, 1)} min for question and answer (JPL orbital elements). The Sun is ${formatNumber(l.sunAngleDeg, 0)}° from Mars as seen from Earth.${l.sunAngleDeg < 5 ? ' Close to solar conjunction: expect a communications blackout.' : ''} The crew must act on its own first and let ground confirm later.`
  }
  if (/heat|strain|psi|overheat|тепл|нагрузк/i.test(q) && snap.science?.psi) {
    const p = snap.science.psi
    return `Physiological Strain Index is ${formatNumber(p.value, 1)} of 10 (${p.category} strain; Moran 1998): cardiovascular part ${formatNumber(p.hrPart, 1)}, thermal part ${formatNumber(p.tcPart, 1)}. Values of 7.5 and above were treated as "at risk" (Buller 2008). ${p.value >= 5 ? GUIDE.bodyTemp!.act.warning : 'No action needed; keep hydrating.'}`
  }
  if (/decompress|bends|prebreathe|nitrogen|tissue ratio|tr|декомпресс|азот/i.test(q) && snap.science?.dcs) {
    const d = snap.science.dcs
    return `With the habitat at ${d.atmosphere.label} (${d.atmosphere.psia} psia, ${Math.round(d.atmosphere.fo2 * 100)} % O2), the tissue ratio ${d.eva ? 'in the suit is' : 'for an EVA starting now would be'} ${formatNumber(d.tr, 2)} (NASA 360-min tissue model). Reaching TR ${NASA_TR_REFERENCE.tr}, the value NASA modelled for the 8.2 psia exploration atmosphere with 15 min prebreathe, needs ${d.prebreatheMin < 1 ? 'no' : `about ${formatNumber(d.prebreatheMin, 0)} min of`} 100 % O2 prebreathe. TR is a relative stress measure, not a go/no-go limit.`
  }
  if (/baseline|personal|unusual|norm\b|z-?score|базов|норм/i.test(q) && snap.science?.baseline) {
    const rs = Object.values(snap.science.baseline).filter((r) => r.ready)
    if (!rs.length) return 'Your personal baseline is still being learned; it needs about a minute of data in each activity (rest and EVA).'
    const dev = rs.filter((r) => r.deviating)
    const line = (r: (typeof rs)[number]) => `${METRICS[r.key].label}: norm ${formatNumber(r.mean, METRICS[r.key].decimals)} ± ${formatNumber(r.sd, METRICS[r.key].decimals + 1)} ${METRICS[r.key].unit} (${r.activity === 'eva' ? 'EVA' : 'rest'}), now ${Number.isFinite(r.z) ? `${formatNumber(r.z, 1)} σ` : 'settling after an activity change'}`
    return `${dev.length ? `Unusual for you right now: ${dev.map((r) => METRICS[r.key].label.toLowerCase()).join(', ')}.` : 'Nothing is unusual for you right now.'} Each vital is compared with your own norm, not only with the general safe range.\n${rs.map(line).join('\n')}`
  }
  if (/radiat|dose|sievert|msv|storm|solar|flare|proton|space weather|радиац|доз|вспышк/i.test(q)) return radiationAnswer(snap, env)
  for (const t of TOPICS) if (t.words.test(q)) return t.keys.map((k) => metricAnswer(snap, k)).join('\n')
  if (/hazard|risk|isolation|gravity|danger|опасн|риск/i.test(q)) return HAZARDS.map((h) => `${h.name}: ${h.note}`).join('\n')
  if (/sleep|mood|check-?in|blood pressure|glucose|сон|настроени/i.test(q)) return 'Use the Daily check-in on the Vitals tab: enter sleep, mood, blood pressure and glucose, and each answer gets a status and advice. Aim for 7+ hours of sleep; a mood of 3 or less is worth a call with a crewmate or behavioural health.'
  if (/how|status|crew|doing|overall|vital|ok\b|summary|state|как|состояни|экипаж/i.test(q)) return statusAnswer(snap)
  return HELP
}
