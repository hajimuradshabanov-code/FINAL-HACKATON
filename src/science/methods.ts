/**
 * One registry of every model in the app: what it computes, the formula, where the constants come
 * from, and what is this app's own assumption. Rendered on the Methods page and kept next to the
 * code so the two cannot drift apart silently.
 */
export interface Source {
  label: string
  href: string
}

export interface Method {
  id: string
  name: string
  /** what question it answers */
  purpose: string
  formulas: string[]
  sources: Source[]
  /** choices made in this app that are not published values */
  assumptions: string[]
  /** how it was checked */
  check: string
  code: string
}

export const SRC = {
  psi: { label: 'Moran et al. 1998, Am J Physiol 275:R129', href: 'https://doi.org/10.1152/ajpregu.1998.275.1.R129' },
  buller08: { label: 'Buller et al. 2008, Physiol Meas 29:N79', href: 'https://doi.org/10.1088/0967-3334/29/12/N01' },
  ectemp: { label: 'Buller et al. 2013, Physiol Meas 34:781', href: 'https://doi.org/10.1088/0967-3334/34/7/781' },
  dcs: { label: 'Conkin, NASA/TP-2020-220529', href: 'https://www.nasa.gov/wp-content/uploads/2023/03/conkin-dcs-survival-models-tp220529-2020.pdf' },
  std3001: { label: 'NASA-STD-3001 radiation technical brief', href: 'https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf' },
  rad: { label: 'Hassler et al. 2014, Science 343:1244797 (MSL-RAD)', href: 'https://doi.org/10.1126/science.1244797' },
  jpl: { label: 'JPL, Approximate Positions of the Planets', href: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html' },
  harris: { label: 'Harris 1974, Clin Chem 20:1535 (index of individuality)', href: 'https://doi.org/10.1093/clinchem/20.12.1535' },
  fraser: { label: 'Fraser & Harris 1989, Crit Rev Clin Lab Sci 27:409 (reference change value)', href: 'https://doi.org/10.3109/10408368909106595' },
  osd569: { label: 'NASA OSDR OSD-569, Inspiration4 complete blood count', href: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-569' },
  osd575: { label: 'NASA OSDR OSD-575, Inspiration4 metabolic panel', href: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-575' },
  montgomery: { label: 'NIST/SEMATECH e-Handbook of Statistical Methods, control charts', href: 'https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc3.htm' },
  parker: { label: 'Parker 1958, Astrophys J 128:664', href: 'https://doi.org/10.1086/146579' },
  richardson: { label: 'Richardson et al. 2014, Sol Phys 289:3059', href: 'https://doi.org/10.1007/s11207-014-0524-8' },
  lario: { label: 'Lario et al. 2006, Astrophys J 653:1531', href: 'https://doi.org/10.1086/508982' },
  bortfeld: { label: 'Bortfeld 1997, Med Phys 24:2024 (range–energy relation)', href: 'https://doi.org/10.1118/1.598116' },
  pstar: { label: 'NIST PSTAR stopping-power tables', href: 'https://physics.nist.gov/PhysRefData/Star/Text/PSTAR.html' },
  zeitlin: { label: 'Zeitlin et al. 2018, Geophys Res Lett 45 (Sept 2017 event on Mars)', href: 'https://www.bexus.org/et/people/forstner/publication/zeitlin-2018' },
  dbm: { label: 'Vršnak et al. 2013, Sol Phys 285:295 (drag-based model)', href: 'https://doi.org/10.1007/s11207-012-0035-4' },
  donki: { label: 'NASA CCMC DONKI', href: 'https://ccmc.gsfc.nasa.gov/tools/DONKI/' },
  goes: { label: 'NOAA SWPC GOES integral proton flux', href: 'https://www.swpc.noaa.gov/products/goes-proton-flux' },
  ncei: { label: 'NOAA NCEI GOES-15 EPEAD/HEPAD archive', href: 'https://www.ncei.noaa.gov/data/goes-space-environment-monitor/access/avg/2017/09/goes15/csv/' },
  bruno: { label: 'Bruno et al. 2019, arXiv:1902.03969 (DONKI values for the Sept 2017 CMEs)', href: 'https://arxiv.org/abs/1902.03969' },
  hotelling: { label: 'NIST/SEMATECH e-Handbook, Hotelling T² control charts', href: 'https://www.itl.nist.gov/div898/handbook/pmc/section5/pmc543.htm' },
  wilson: { label: 'Wilson 1927, J Am Stat Assoc 22:209 (score interval)', href: 'https://doi.org/10.1080/01621459.1927.10502953' },
} as const satisfies Record<string, Source>

export const METHODS: readonly Method[] = [
  {
    id: 'baseline',
    name: 'Personal baseline',
    purpose: 'How far is a vital from this crew member’s own norm, even while it is still inside the population range?',
    formulas: [
      'μ, σ² ← exponentially weighted mean and variance (half-life 120 s), separately for rest and EVA',
      'z = (mean of last 5 s − μ) / σ',
      'deviation: |z| ≥ 3.5 for 4 s; in the 45 s after a rest↔EVA switch z is the distance outside the [μ_rest, μ_EVA] envelope',
      'no learning while a deviation is reported, for at most 10 min (then the new level becomes the norm)',
    ],
    sources: [SRC.harris, SRC.montgomery, SRC.osd569, SRC.osd575],
    assumptions: ['half-life, limit, persistence and settle time are tuned for the 1 Hz demo stream; a mission would use hours to days', 'hydration and dose have no stationary norm and are excluded'],
    check: 'Injection tests on held-out random seeds (Validation tab); justification from real crew data (Evidence tab).',
    code: 'src/science/baseline.ts',
  },
  {
    id: 'joint',
    name: 'Joint deviation of several vitals',
    purpose: 'Are several vitals moving a little at the same time, in a recognisable pattern?',
    formulas: [
      'T² = Σ zᵢ² over heart rate, SpO₂, core temperature and respiration (diagonal Hotelling T²)',
      'reported when T² ≥ 10 for 6 s',
      'pattern = signature with the highest cosine similarity to the z-vector, if ≥ 0.75',
    ],
    sources: [SRC.hotelling, SRC.wilson],
    assumptions: ['off-diagonal covariance ignored; limit tuned on undisturbed runs instead of the χ² table', 'the four signatures (low oxygen, heat strain, pressure loss, cold stress) are written by this app from textbook physiology'],
    check: 'Injection tests with a three-vital low-oxygen pattern (Validation tab), with 95 % Wilson intervals.',
    code: 'src/science/joint.ts',
  },
  {
    id: 'hindcast',
    name: 'Hindcast of the September 2017 event',
    purpose: 'Does the Earth→Mars radiation model reproduce what MSL-RAD measured?',
    formulas: [
      'inputs: GOES-15 peak ≥10, ≥100 and ≥510 MeV fluxes minus the 1–3 Sept background; DONKI CME direction and half-width',
      'observed excess = 244 µGy/day × (2…3 − 1) = 10–20 µGy/h',
      'error = observed mid-point ÷ predicted peak dose rate',
    ],
    sources: [SRC.zeitlin, SRC.ncei, SRC.donki, SRC.bruno],
    assumptions: ['peak rates compared without regard to timing', 'west-looking EPEAD detector; HEPAD differential channels summed to an integral above 510 MeV'],
    check: 'One event; the model was revised after it and the upper bound is set from it. The 2021 and 2024 events would be independent tests and have not been run.',
    code: 'src/science/hindcast.ts, scripts/fetch-hindcast.ts',
  },
  {
    id: 'osdr',
    name: 'Individuality of astronaut blood values (OSDR)',
    purpose: 'Does real astronaut data support personal baselines over population ranges?',
    formulas: [
      'one-way ANOVA on 3 pre-flight draws per crew member: s_w² = MS_within, s_g² = (MS_between − MS_within)/3',
      'index of individuality II = CV_I / CV_G; II < 0.6 → population range insensitive for an individual',
      'personal deviation: |x − mean_i| > t(0.975, df) · s_w · √(1 + 1/3); population deviation: outside the laboratory range',
    ],
    sources: [SRC.osd569, SRC.osd575, SRC.harris, SRC.fraser],
    assumptions: ['CV_I includes analytical variation (no replicate measurements in the dataset)', 'one misaligned draw in the published CBC file is excluded, not repaired', '4 people: this supports the approach, it does not define clinical norms'],
    check: 'Leave-one-out on the pre-flight draws gives the false-flag rate of each yardstick.',
    code: 'src/science/osdr.ts',
  },
  {
    id: 'sep',
    name: 'Solar protons: from GOES at Earth to the Mars surface',
    purpose: 'What does a proton flux measured in Earth orbit mean for a crew member standing on Mars?',
    formulas: [
      'footpoint longitude = observer longitude + Ω·r / v_sw (Parker spiral; 61° at 1 au, 400 km/s)',
      'J_Mars / J_Earth = r_M^−α · exp(−(Δ_M² − Δ_E²) / 2σ²), α = 1.9 (range 1.0–2.7), σ = 43°; Δ is measured from the edge of the CME (its half-width), not from a point',
      'γ = ln(J≥100 / J≥500) / ln 5 when the ≥500 MeV channel is above background, else log10(J≥10 / J≥100); J(>150 MeV) = J≥100 · 1.5^−γ (atmospheric cut-off, 21 g/cm² CO₂)',
      'Ω_eff = 2π / (1 + γ/p), p = 1.77; extra shielding x: × ((21 + x)/21)^(−γ/p)',
      'dose rate = Ω_eff · J · S · 1.602·10⁻¹⁰ Gy/s, S = 5.4 MeV cm²/g, Q = 1',
      'upper bound = (estimate at α = 1.0) × 20, the residual of the 2017 hindcast; decisions use the upper bound',
    ],
    sources: [SRC.goes, SRC.parker, SRC.richardson, SRC.lario, SRC.rad, SRC.bortfeld, SRC.pstar, SRC.zeitlin],
    assumptions: [
      'radial exponent measured inside 1 au is extrapolated to 1.4–1.7 au',
      'source longitude = fastest DONKI CME of the last 72 h; ecliptic and solar equator treated as one plane',
      'one power law above 100 MeV; secondary neutrons not modelled; no time dependence (peak rates only)',
      'shielding areal densities: suit 0.5, rover 5, habitat 10, shelter 30 g/cm²',
    ],
    check: 'Hindcast of the 10 Sep 2017 event against MSL-RAD (Evidence tab): the first version was about 320× too low, the current one about 20× too low, with the measurement inside its bounds. One event, used to set the upper bound: a calibration, not an independent validation.',
    code: 'src/science/radiation.ts',
  },
  {
    id: 'cme',
    name: 'CME arrival at Mars',
    purpose: 'Will an eruption reported by DONKI reach Mars, and when?',
    formulas: [
      'hit: angle between the CME axis and the Sun–Mars line ≤ CME half-width',
      'drag-based model from 21.5 R☉: r(t) = ±(1/γ) ln(1 ± γ(v₀ − w)t) + wt + r₀',
      'window: γ ∈ {0.1, 0.2, 0.5, 1.0}·10⁻⁷ km⁻¹ × w ∈ {350, 400, 450, 500} km/s',
    ],
    sources: [SRC.dbm, SRC.donki, SRC.jpl],
    assumptions: ['constant drag and solar-wind speed', 'cone model with the DONKI half-width; no deflection or interaction between CMEs'],
    check: 'A 1000 km/s CME reaches 1 au in 52 h at 584 km/s, between the ballistic (41.6 h) and solar-wind (104 h) limits.',
    code: 'src/science/radiation.ts',
  },
  {
    id: 'decision',
    name: 'EVA radiation decision',
    purpose: 'Continue the EVA, stay near shelter, or return?',
    formulas: [
      'return to shelter: upper-bound solar-proton dose over an 8 h EVA ≥ 1 mSv, or career dose ≥ 600 mSv',
      'caution: upper bound ≥ 0.1 mSv per EVA; or a ≥ 500 km/s CME aimed at Mars arriving within 24 h; or a ≥ 800 km/s eruption within σ of Mars’ field line while Earth would see under 40 % of its peak (GOES blind)',
    ],
    sources: [SRC.std3001, SRC.rad],
    assumptions: ['the 1 mSv and 0.1 mSv action levels are this app’s ALARA choices (≈ 1.5 sols and ≈ half an EVA of background), not NASA flight rules'],
    check: 'Worked examples on the Science tab; unit tests for each rule; on the 2017 event it returns “caution”, in line with the 0.08–0.16 mSv an 8 h EVA at the measured peak would have received.',
    code: 'src/science/radiation.ts',
  },
  {
    id: 'budget',
    name: 'Radiation budget',
    purpose: 'How much of a career limit has the mission used?',
    formulas: ['used = dose / 600 mSv; background 0.67 mSv/sol on the Mars surface'],
    sources: [SRC.std3001, SRC.rad],
    assumptions: ['surface background taken as constant (it varies with the solar cycle and pressure)'],
    check: '500 sols at the MSL-RAD rate = 335 mSv (unit test).',
    code: 'src/science/models.ts',
  },
  {
    id: 'psi',
    name: 'Physiological Strain Index',
    purpose: 'Combined heat and cardiovascular strain on a 0–10 scale.',
    formulas: ['PSI = 5(Tc − Tc₀)/(39.5 − Tc₀) + 5(HR − HR₀)/(180 − HR₀)'],
    sources: [SRC.psi, SRC.buller08],
    assumptions: ['chest-patch temperature stands in for rectal temperature', 'baseline = first 30 s of the session'],
    check: '0 at baseline, 10 at 39.5 °C and 180 bpm (unit test).',
    code: 'src/science/models.ts',
  },
  {
    id: 'ectemp',
    name: 'Core temperature from heart rate (ECTemp)',
    purpose: 'An independent estimate to cross-check the temperature sensor.',
    formulas: ['extended Kalman filter, one step per minute: HR = −4.5714·CT² + 384.4286·CT − 7887.1, γ = 0.022, σ = 18.88, CT₀ = 37.1 °C'],
    sources: [SRC.ectemp],
    assumptions: ['0.5 °C disagreement flag'],
    check: 'Converges to the temperature whose model heart rate equals the observed one (unit test).',
    code: 'src/science/models.ts',
  },
  {
    id: 'dcs',
    name: 'Decompression stress (tissue ratio)',
    purpose: 'How much oxygen prebreathe does an EVA need from a given habitat atmosphere?',
    formulas: ['TR = P_N₂(360-min tissue) / P_suit; P_N₂(t) = P_amb + (P₀ − P_amb)·2^(−t/360)'],
    sources: [SRC.dcs],
    assumptions: ['dry-gas partial pressures'],
    check: 'Gives TR 1.22 for 8.2 psia / 34 % O₂ + 15 min prebreathe; NASA models ≈ 1.23 (unit test).',
    code: 'src/science/models.ts',
  },
  {
    id: 'link',
    name: 'Earth–Mars distance and signal delay',
    purpose: 'How long does a call for help take?',
    formulas: ['Keplerian elements + rates → heliocentric positions; delay = distance / c'],
    sources: [SRC.jpl],
    assumptions: ['5° solar-conjunction flag'],
    check: 'Jan 2025 closest approach 0.642 au; Jan 2026 conjunction (unit test).',
    code: 'src/science/models.ts',
  },
  {
    id: 'trend',
    name: 'Early warning (trend forecast)',
    purpose: 'Is a vital heading for its warning level?',
    formulas: [
      'least-squares slope over the last 60 s; time to threshold = (threshold − value) / slope',
      'reported only when R² ≥ 0.6, the trend is not flattening, the crossing is within 15 min, and the vital has been ≥ 2.5 σ outside the personal norm in that direction for 6 s',
    ],
    sources: [SRC.montgomery],
    assumptions: ['all acceptance rules are app choices; without the personal-baseline gate the same forecast raised about 200 reports per hour on undisturbed data'],
    check: 'Injection tests (Validation tab).',
    code: 'src/science/models.ts, src/science/engine.ts',
  },
]
