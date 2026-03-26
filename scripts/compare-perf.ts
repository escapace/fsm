import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

interface CLIOptions {
  benchCurrent: string
  benchPrevious: string
  json: boolean
  profileCurrent: string
  profilePrevious: string
}

interface VitestBenchmark {
  hz: number
  name: string
}

interface VitestBenchmarkGroup {
  benchmarks: VitestBenchmark[]
  fullName: string
}

interface VitestBenchmarkFile {
  groups: VitestBenchmarkGroup[]
}

interface VitestBenchmarkOutput {
  files: VitestBenchmarkFile[]
}

interface ProfileScenario {
  perOpUs: number
}

interface ProfileAnalysis {
  scenarios: Record<string, ProfileScenario>
}

interface BenchRatioEntry {
  baselineHz: number
  benchmarkHz: number
  benchmarkName: string
  groupName: string
  key: string
  ratio: number
}

interface BenchRatioDelta {
  current: BenchRatioEntry
  previous: BenchRatioEntry
  ratioPointDelta: number
  relativeDelta: number
}

interface ProfileComparison {
  current: Record<string, number>
  delta: Record<string, number>
  previous: Record<string, number>
  relativeDelta: Record<string, number | null>
}

const resolveAbsolutePath = (value: string): string => path.resolve(process.cwd(), value)

const loadJsonFile = <T>(filePath: string): T => {
  const content = readFileSync(filePath, 'utf-8')
  return JSON.parse(content) as T
}

const parseCLI = (argv: string[]): CLIOptions => {
  const arguments_ = argv.filter((token) => token !== '--')

  const parsed = parseArgs({
    allowPositionals: false,
    args: arguments_,
    options: {
      'bench-current': { type: 'string' },
      'bench-previous': { type: 'string' },
      json: { default: false, type: 'boolean' },
      'profile-current': { type: 'string' },
      'profile-previous': { type: 'string' },
    },
    strict: true,
  })

  const benchCurrent = parsed.values['bench-current']
  const benchPrevious = parsed.values['bench-previous']
  const profileCurrent = parsed.values['profile-current']
  const profilePrevious = parsed.values['profile-previous']

  if (
    benchCurrent === undefined ||
    benchPrevious === undefined ||
    profileCurrent === undefined ||
    profilePrevious === undefined
  ) {
    throw new Error(
      'Missing required arguments --bench-previous, --bench-current, --profile-previous, --profile-current',
    )
  }

  return {
    benchCurrent: resolveAbsolutePath(benchCurrent),
    benchPrevious: resolveAbsolutePath(benchPrevious),
    json: parsed.values.json,
    profileCurrent: resolveAbsolutePath(profileCurrent),
    profilePrevious: resolveAbsolutePath(profilePrevious),
  }
}

const ratioKey = (groupName: string, benchmarkName: string): string => `${groupName} :: ${benchmarkName}`

const extractBenchRatios = (input: VitestBenchmarkOutput): Map<string, BenchRatioEntry> => {
  const ratios = new Map<string, BenchRatioEntry>()

  for (const file of input.files) {
    for (const group of file.groups) {
      const baseline = group.benchmarks.find((benchmark) => benchmark.name.startsWith('baseline x'))

      if (baseline === undefined || !Number.isFinite(baseline.hz) || baseline.hz <= 0) {
        continue
      }

      for (const benchmark of group.benchmarks) {
        if (
          benchmark.name === baseline.name ||
          !Number.isFinite(benchmark.hz) ||
          benchmark.hz <= 0
        ) {
          continue
        }

        const key = ratioKey(group.fullName, benchmark.name)

        ratios.set(key, {
          baselineHz: baseline.hz,
          benchmarkHz: benchmark.hz,
          benchmarkName: benchmark.name,
          groupName: group.fullName,
          key,
          ratio: benchmark.hz / baseline.hz,
        })
      }
    }
  }

  return ratios
}

const toSignedRelativeDelta = (delta: number, previous: number): number | null =>
  Number.isFinite(previous) && previous !== 0 ? delta / Math.abs(previous) : null

const compareBenchRatios = (
  previous: Map<string, BenchRatioEntry>,
  current: Map<string, BenchRatioEntry>,
): BenchRatioDelta[] => {
  const deltas: BenchRatioDelta[] = []

  for (const [key, currentEntry] of current.entries()) {
    const previousEntry = previous.get(key)

    if (previousEntry === undefined) {
      continue
    }

    const ratioPointDelta = currentEntry.ratio - previousEntry.ratio
    const relativeDelta = toSignedRelativeDelta(ratioPointDelta, previousEntry.ratio)

    if (relativeDelta === null) {
      continue
    }

    deltas.push({
      current: currentEntry,
      previous: previousEntry,
      ratioPointDelta,
      relativeDelta,
    })
  }

  deltas.sort((left, right) => left.current.groupName.localeCompare(right.current.groupName))
  return deltas
}

const mustScenario = (analysis: ProfileAnalysis, name: string): number => {
  const scenario = analysis.scenarios[name]

  if (scenario === undefined) {
    throw new Error(`Scenario "${name}" not found in profile analysis`)
  }

  return scenario.perOpUs
}

const extractProfileComponents = (analysis: ProfileAnalysis): Record<string, number> => {
  const direct = mustScenario(analysis, 'direct-dispatch')
  const discard = mustScenario(analysis, 'draft-create-discard')
  const doDiscard = mustScenario(analysis, 'draft-create-do-discard')
  const commit = mustScenario(analysis, 'draft-create-do-commit')

  return {
    commit_over_direct: commit / direct,
    commit_over_do_discard: commit / doDiscard,
    commit_replay: commit - doDiscard,
    construction: discard - direct,
    discard_over_direct: discard / direct,
    do_discard_over_direct: doDiscard / direct,
    do_discard_over_discard: doDiscard / discard,
    draft_step: doDiscard - discard,
  }
}

const compareProfile = (previous: ProfileAnalysis, current: ProfileAnalysis): ProfileComparison => {
  const previousValues = extractProfileComponents(previous)
  const currentValues = extractProfileComponents(current)

  const delta: Record<string, number> = {}
  const relativeDelta: Record<string, number | null> = {}

  for (const [key, currentValue] of Object.entries(currentValues)) {
    const previousValue = previousValues[key]

    delta[key] = previousValue - currentValue
    relativeDelta[key] = toSignedRelativeDelta(delta[key], previousValue)
  }

  return {
    current: currentValues,
    delta,
    previous: previousValues,
    relativeDelta,
  }
}

const formatSigned = (value: number, digits: number, suffix = ''): string => {
  const rounded = Number(value.toFixed(digits))

  if (Object.is(rounded, -0) || rounded === 0) {
    return `0${suffix}`
  }

  const sign = rounded > 0 ? '+' : '-'
  return `${sign}${Math.abs(rounded).toFixed(digits)}${suffix}`
}

const formatSignedOptional = (value: number | null, digits: number, suffix = ''): string => {
  if (value === null) {
    return 'n/a'
  }

  return formatSigned(value, digits, suffix)
}

const printTextReport = (benchDeltas: BenchRatioDelta[], profile: ProfileComparison): void => {
  console.log('Sign guide:')
  console.log('  - Bench ratioPointDelta: current normalized ratio minus previous normalized ratio. Positive means improvement; negative means regression.')
  console.log('  - Bench relativeDelta: signed percent change magnitude vs previous normalized ratio, using |previous| as denominator. Positive means improvement; negative means regression.')
  console.log('  - Profile delta: previous normalized metric minus current normalized metric. Positive means improvement; negative means regression.')
  console.log('  - Profile relativeDelta: signed percent change magnitude vs previous normalized metric, using |previous| as denominator. Positive means improvement; negative means regression.')
  console.log('  - Non-zero numeric values include an explicit sign; exact zero is printed as 0.')
  console.log('')
  console.log('Benchmark normalized ratio deltas (current vs previous accepted):')

  for (const entry of benchDeltas) {
    console.log(`- ${entry.current.groupName}`)
    console.log(
      `  - ${entry.current.benchmarkName}: ratioPointDelta=${formatSigned(entry.ratioPointDelta, 6)} relativeDelta=${formatSigned(entry.relativeDelta * 100, 2, '%')}`,
    )
  }

  console.log('')
  console.log('Profile normalized decomposition + relationship deltas (current vs previous accepted):')

  for (const key of Object.keys(profile.delta).sort()) {
    const delta = profile.delta[key]
    const relativeDelta = profile.relativeDelta[key]
    const relativeDeltaPercent = relativeDelta == null ? null : relativeDelta * 100
    console.log(
      `- ${key}: delta=${formatSigned(delta, 6)} relativeDelta=${formatSignedOptional(relativeDeltaPercent, 2, '%')}`,
    )
  }
}

const printUsage = (): void => {
  console.log('Usage:')
  console.log(
    '  tsx scripts/compare-perf.ts --bench-previous <path> --bench-current <path> --profile-previous <path> --profile-current <path> [--json]',
  )
  console.log('')
  console.log('Notes:')
  console.log('  - Bench files must be Vitest bench --outputJson artifacts.')
  console.log('  - Profile files must be scripts/profile.ts analysis.json artifacts.')
  console.log('  - This script compares data only; it does not run benchmarks or profiles.')
}

const main = (): void => {
  let options: CLIOptions

  try {
    options = parseCLI(process.argv.slice(2))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Argument error: ${message}`)
    printUsage()
    process.exitCode = 1
    return
  }

  const benchPrevious = loadJsonFile<VitestBenchmarkOutput>(options.benchPrevious)
  const benchCurrent = loadJsonFile<VitestBenchmarkOutput>(options.benchCurrent)
  const profilePrevious = loadJsonFile<ProfileAnalysis>(options.profilePrevious)
  const profileCurrent = loadJsonFile<ProfileAnalysis>(options.profileCurrent)

  const benchDeltas = compareBenchRatios(extractBenchRatios(benchPrevious), extractBenchRatios(benchCurrent))
  const profileComparison = compareProfile(profilePrevious, profileCurrent)

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          bench: benchDeltas.map((entry) => ({
            benchmarkName: entry.current.benchmarkName,
            groupName: entry.current.groupName,
            ratioPointDelta: entry.ratioPointDelta,
            relativeDelta: entry.relativeDelta,
          })),
          profile: {
            delta: profileComparison.delta,
            relativeDelta: profileComparison.relativeDelta,
          },
        },
        null,
        2,
      ),
    )

    return
  }

  printTextReport(benchDeltas, profileComparison)
}

main()
