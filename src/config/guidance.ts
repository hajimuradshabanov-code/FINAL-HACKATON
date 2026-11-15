import type { MetricKey, Status } from './thresholds'

export interface Guide {
  what: string
  why: string
  hazard: string
  act: Record<Exclude<Status, 'normal'>, string>
}

export const GUIDE: Partial<Record<MetricKey, Guide>> = {
  heartRate: {
    what: 'Beats per minute, read from the chest sensor ECG.',
    why: 'Shows cardiovascular load and early arrhythmia or dehydration.',
    hazard: 'Fluid shifts in altered gravity and exertion during EVA raise resting heart rate.',
    act: {
      warning: 'Stop and rest for 5 minutes, sip water, slow your breathing (4 s in, 6 s out).',
      critical: 'Halt the EVA task, return to airlock, and call the flight surgeon with a 12-lead ECG upload.',
    },
  },
  spo2: {
    what: 'Percent of haemoglobin carrying oxygen.',
    why: 'First sign of low suit O₂, CO₂ build-up or lung problems.',
    hazard: 'A closed environment lets CO₂ accumulate; dust can irritate lungs.',
    act: {
      warning: 'Check PLSS O₂ flow and CO₂ scrubber status, breathe slowly, reduce exertion.',
      critical: 'Switch to backup O₂ and abort to the airlock immediately; notify ground.',
    },
  },
  hydration: {
    what: 'Estimated body water from suit intake versus sweat loss.',
    why: 'Dehydration drops blood volume and impairs judgment and heat control.',
    hazard: 'Reduced thirst signals in microgravity and long EVAs.',
    act: {
      warning: 'Drink 250 ml from the in-suit bag now and again in 30 minutes.',
      critical: 'Stop work, drink, and plan an early return; log intake with the flight surgeon.',
    },
  },
  bodyTemp: {
    what: 'Core temperature from the chest patch.',
    why: 'Shows overheating in the suit or cold exposure and possible infection.',
    hazard: 'The suit cooling loop is the only heat path; immune changes raise infection risk.',
    act: {
      warning: 'Adjust the liquid cooling garment one step and reduce work rate.',
      critical: 'Return to the habitat, passive cool/warm, and report symptoms to the flight surgeon.',
    },
  },
  suitPressure: {
    what: 'Internal suit pressure in psi.',
    why: 'Too low risks decompression sickness; too high stiffens gloves and joints.',
    hazard: 'Micrometeorite punctures and seal wear in the hostile environment.',
    act: {
      warning: 'Inspect visible seals and re-check in one minute.',
      critical: 'Treat as a possible leak: seal off, head to the airlock, and run the leak checklist.',
    },
  },
  radiation: {
    what: 'Accumulated ionising radiation dose in millisieverts.',
    why: 'Long-term dose raises cancer, cardiovascular and cognitive risk.',
    hazard: 'Space radiation: little magnetic shielding on Mars and on deep-space transit.',
    act: {
      warning: 'Shorten surface time and plan work near the shielded shelter.',
      critical: 'Move to the storm shelter and follow the solar-particle-event protocol.',
    },
  },
}

export const HAZARDS = [
  { id: 'radiation', name: 'Space radiation', metrics: ['radiation'], note: 'Tracked as cumulative dose. Risks: cancer, cardiovascular disease, central nervous system effects.' },
  { id: 'isolation', name: 'Isolation & confinement', metrics: [], note: 'Tracked via daily mood and sleep check-in. Risks: low mood, sleep disruption, team conflict.' },
  { id: 'distance', name: 'Distance from Earth', metrics: ['signal'], note: 'Communication delay means the crew self-assesses first; ground confirms later.' },
  { id: 'gravity', name: 'Altered gravity', metrics: ['heartRate', 'bodyTemp'], note: 'Fluid shifts, bone and muscle loss, balance changes. Exercise 2 h/day is the main counter-measure.' },
  { id: 'closed', name: 'Hostile closed environment', metrics: ['spo2', 'suitPressure', 'hydration'], note: 'Air quality, pressure and water are life-critical and monitored continuously.' },
] as const

export interface SelfStatus {
  status: Status
  advice: string
}

/**
 * Cut-offs for the self-reported items, each from a published guideline (see SELF_REPORT_SOURCES).
 * The mapping of guideline categories onto normal / warning / critical is this app's.
 */
export const SELF_REPORT_SOURCES = {
  sleep: { label: 'Watson et al. 2015, AASM/SRS consensus (Sleep 38:843)', href: 'https://doi.org/10.5665/sleep.4716', rule: '≥ 7 h recommended for adults; 6–7 h short; < 6 h insufficient' },
  bp: { label: 'Whelton et al. 2018, ACC/AHA guideline (Hypertension 71:e13)', href: 'https://doi.org/10.1161/HYP.0000000000000065', rule: 'normal < 120 and < 80; elevated or stage 1 up to 139 / 89; stage 2 ≥ 140 or ≥ 90; low < 90 / 60' },
  glucose: { label: 'American Diabetes Association, Standards of Care in Diabetes', href: 'https://diabetesjournals.org/care/issue/47/Supplement_1', rule: 'hypoglycaemia level 1 < 70, level 2 < 54 mg/dL; fasting normal 70–99; ≤ 140 two hours after a meal; ≥ 200 diagnostic range' },
  mood: { label: 'no clinical cut-off', href: '', rule: 'single 1–5 self-rating; ≤ 2 low, 3 neutral (app choice, not a validated scale)' },
} as const

export const assessSleep = (h: number): SelfStatus =>
  h >= 7 ? { status: 'normal', advice: 'Meets the 7 h recommended for adults. Keep a fixed sleep window.' }
  : h >= 6 ? { status: 'warning', advice: 'Short sleep slows reaction time. Plan a 20 min nap and avoid complex tasks first.' }
  : { status: 'critical', advice: 'Under 6 h is insufficient sleep. Postpone EVA and tell the flight surgeon.' }

export const assessMood = (m: number): SelfStatus =>
  m >= 4 ? { status: 'normal', advice: 'Good. Share a call or hobby time with the crew.' }
  : m === 3 ? { status: 'warning', advice: 'Neutral mood. Try 15 min of exercise or a private call to family.' }
  : { status: 'critical', advice: 'Low mood. Talk to a crewmate and book a behavioural-health call.' }

export const assessBP = (sys: number, dia: number): SelfStatus =>
  sys >= 140 || dia >= 90
    ? { status: 'critical', advice: 'Stage 2 range (≥ 140 or ≥ 90). Rest seated for 5 minutes and re-measure; if repeated, contact the flight surgeon.' }
    : sys < 90 || dia < 60
      ? { status: 'warning', advice: 'Low (< 90 / 60). Drink, stand up slowly and re-measure; report dizziness.' }
      : sys >= 120 || dia >= 80
        ? { status: 'warning', advice: 'Elevated / stage 1 range (120–139 or 80–89). Cut sodium, hydrate, and re-measure in an hour.' }
        : { status: 'normal', advice: 'Normal (below 120 / 80 mmHg).' }

export const assessGlucose = (mg: number): SelfStatus =>
  mg < 54 ? { status: 'critical', advice: 'Level 2 hypoglycaemia (< 54 mg/dL). Take 15 g of fast carbohydrate now, re-test in 15 minutes and tell the flight surgeon.' }
  : mg < 70 ? { status: 'warning', advice: 'Low blood sugar (< 70 mg/dL). Take 15 g of fast carbohydrate and re-test in 15 minutes.' }
  : mg <= 140 ? { status: 'normal', advice: 'Normal. Fasting 70–99 mg/dL, up to 140 mg/dL two hours after a meal.' }
  : mg < 200 ? { status: 'warning', advice: 'Elevated. Walk lightly, drink water, and re-test fasting.' }
  : { status: 'critical', advice: 'High (≥ 200 mg/dL). Report to the flight surgeon and re-test in 30 minutes.' }
