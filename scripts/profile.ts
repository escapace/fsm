/**
 * Draft-performance profiling workflow.
 *
 * Single orchestrator: bundles the harness with esbuild, runs scenarios with
 * node --cpu-prof and --heap-prof, collects V8 trace logs, computes MECE
 * delta attribution for CPU time and allocation volume, ranks optimization
 * targets, and writes one canonical report.md.
 *
 * Usage:
 *   pnpm profile
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire, SourceMap } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

// ---------------------------------------------------------------------------
// Workflow configuration
//
// All tunable parameters live here. To extend the workflow (e.g. add a
// scenario, change iteration count, adjust sampling), edit this object.
// ---------------------------------------------------------------------------

/** A single profiling scenario. */
interface ScenarioDefinition {
  /** Identifier passed to the harness as argv[2]. Must match a branch in the harness. */
  name: string
}

/** MECE delta definition: later minus earlier isolates one cost component. */
interface DeltaDefinition {
  /** Earlier (baseline) scenario name. */
  earlier: string
  /** Human-readable label used in the report. */
  label: string
  /** Later (more-expensive) scenario name. */
  later: string
  /** Short key used in analysis.json. */
  name: string
}

/** Full workflow configuration. */
interface WorkflowConfig {
  /** V8 CPU-profiler sampling interval in microseconds. Lower = finer grain, higher overhead. */
  cpuProfInterval: number
  /** MECE delta pairs. Each pair references scenario names defined in `scenarios`. */
  deltas: DeltaDefinition[]
  /** Path to the harness source file (resolved at bundle time by esbuild). */
  harnessSource: string
  /** V8 heap-profiler sampling interval in bytes. Lower = more samples, higher overhead. */
  heapProfInterval: number
  /** Number of measured iterations per scenario. */
  iterations: number
  /** Maximum iterations used for the --trace-opt/--trace-deopt pass (caps verbose output). */
  maxTraceIterations: number
  /** Repository root (absolute path). */
  root: string
  /** Ordered list of scenarios to run. */
  scenarios: ScenarioDefinition[]
  /** Child-process timeout in milliseconds. */
  timeout: number
  /** Number of warmup iterations before the measured phase. */
  warmup: number
}

const ROOT = path.resolve(import.meta.dirname, '..')

const config: WorkflowConfig = {
  cpuProfInterval: 100,
  deltas: [
    {
      earlier: 'direct-dispatch',
      label: 'Construction (create+discard − direct)',
      later: 'draft-create-discard',
      name: 'construction',
    },
    {
      earlier: 'draft-create-discard',
      label: 'Draft step (create+do+discard − create+discard)',
      later: 'draft-create-do-discard',
      name: 'draft-step',
    },
    {
      earlier: 'draft-create-do-discard',
      label: 'Commit replay (create+do+commit − create+do+discard)',
      later: 'draft-create-do-commit',
      name: 'commit-replay',
    },
  ],
  harnessSource: path.join(ROOT, 'perf', 'profile-draft-harness.ts'),
  heapProfInterval: 256,
  iterations: 500_000,
  maxTraceIterations: 50_000,
  root: ROOT,
  scenarios: [
    { name: 'done-only' },
    { name: 'interpret-only' },
    { name: 'direct-dispatch' },
    { name: 'draft-create-discard' },
    { name: 'draft-create-do-discard' },
    { name: 'draft-create-do-commit' },
  ],
  timeout: 120_000,
  warmup: 50_000,
}

// ---------------------------------------------------------------------------
// ULID generation (time-sortable, lexicographically ordered)
//
// 48-bit millisecond timestamp (10 Crockford base32 chars) +
// 80-bit cryptographic random  (16 Crockford base32 chars) = 26 chars total.
// Sorts by creation time when compared as strings.
// ---------------------------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function ulid(): string {
  const now = Date.now()
  const random = randomBytes(10) // 80 bits

  // Encode 48-bit timestamp (big-endian, 10 chars)
  const time = new Array<string>(10)

  let remaining = now

  for (let index = 9; index >= 0; index--) {
    time[index] = CROCKFORD[remaining & 0x1f]
    remaining = Math.floor(remaining / 32)
  }

  // Encode 80-bit random (16 chars)
  const rand = new Array<string>(16)
  let bitBuffer = 0
  let bitsInBuffer = 0
  let byteIndex = 0
  let charIndex = 0

  while (charIndex < 16) {
    if (bitsInBuffer < 5) {
      bitBuffer = (bitBuffer << 8) | random[byteIndex++]
      bitsInBuffer += 8
    }

    rand[charIndex++] = CROCKFORD[(bitBuffer >>> (bitsInBuffer - 5)) & 0x1f]
    bitsInBuffer -= 5
  }

  return time.join('') + rand.join('')
}

// ---------------------------------------------------------------------------
// Resolve esbuild from pnpm store (transitive dep of esroll)
// ---------------------------------------------------------------------------

const ESBUILD_PATH = (() => {
  const pnpmDirectory = path.join(config.root, 'node_modules', '.pnpm')
  const candidates = readdirSync(pnpmDirectory).filter((d) => d.startsWith('esbuild@'))

  if (candidates.length === 0) {
    throw new Error('esbuild not found in pnpm store — is esroll installed?')
  }

  return path.join(pnpmDirectory, candidates[0], 'node_modules', 'esbuild')
})()

// ---------------------------------------------------------------------------
// Output directory
// ---------------------------------------------------------------------------

const runId = ulid()
const outputDirectory = path.join(config.root, 'perf', 'profiles', runId)
mkdirSync(outputDirectory, { recursive: true })

// ---------------------------------------------------------------------------
// Bundle harness with esbuild for accurate source positions
// ---------------------------------------------------------------------------

function bundleHarness(): { bundlePath: string; sourceMap: SourceMap } {
  const bundlePath = path.join(outputDirectory, 'harness.mjs')

  const esbuild = require(ESBUILD_PATH) as {
    buildSync: (options: Record<string, unknown>) => void
  }

  esbuild.buildSync({
    bundle: true,
    entryPoints: [config.harnessSource],
    format: 'esm',
    outfile: bundlePath,
    platform: 'node',
    sourcemap: true,
    target: 'esnext',
  })

  const rawMap = JSON.parse(
    readFileSync(`${bundlePath}.map`, 'utf-8'),
  ) as import('node:module').SourceMapPayload
  const sourceMap = new SourceMap(rawMap)

  return { bundlePath, sourceMap }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodeVersion(): string {
  return process.version
}

function commitHash(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: config.root,
      encoding: 'utf-8',
    }).trim()
  } catch {
    return 'unknown'
  }
}

interface ScenarioArtifacts {
  cpuprofilePath: string
  heapprofilePath: string
  traceLogPath: string
}

function runScenario(scenario: string, bundlePath: string): ScenarioArtifacts {
  const rawDirectory = path.join(outputDirectory, 'raw')
  mkdirSync(rawDirectory, { recursive: true })

  const traceLogPath = path.join(rawDirectory, `${scenario}.trace.log`)

  // --- CPU profile pass ---
  const cpuProfArguments = [
    '--cpu-prof',
    `--cpu-prof-dir=${rawDirectory}`,
    `--cpu-prof-name=${scenario}.cpuprofile`,
    `--cpu-prof-interval=${config.cpuProfInterval}`,
    bundlePath,
    scenario,
    String(config.iterations),
    String(config.warmup),
  ]

  console.log(`  [cpu]  ${scenario}`)
  execFileSync(process.execPath, cpuProfArguments, {
    cwd: config.root,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: config.timeout,
  })

  // --- Heap profile pass ---
  const heapProfArguments = [
    '--heap-prof',
    `--heap-prof-dir=${rawDirectory}`,
    `--heap-prof-name=${scenario}.heapprofile`,
    `--heap-prof-interval=${config.heapProfInterval}`,
    bundlePath,
    scenario,
    String(config.iterations),
    String(config.warmup),
  ]

  console.log(`  [heap] ${scenario}`)
  execFileSync(process.execPath, heapProfArguments, {
    cwd: config.root,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: config.timeout,
  })

  // --- V8 trace-opt/trace-deopt pass (capped iterations) ---
  const traceArguments = [
    '--trace-opt',
    '--trace-deopt',
    bundlePath,
    scenario,
    String(Math.min(config.iterations, config.maxTraceIterations)),
    String(config.warmup),
  ]

  try {
    const result = execFileSync(process.execPath, traceArguments, {
      cwd: config.root,
      encoding: 'utf-8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: config.timeout,
    })

    writeFileSync(traceLogPath, result)
  } catch (error: unknown) {
    const stderr =
      error !== null && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr: unknown }).stderr)
        : ''
    const stdout =
      error !== null && typeof error === 'object' && 'stdout' in error
        ? String((error as { stdout: unknown }).stdout)
        : ''
    writeFileSync(traceLogPath, stdout + '\n' + stderr)
  }

  // --- Locate artifacts ---
  const cpuprofilePath = path.join(rawDirectory, `${scenario}.cpuprofile`)

  if (!existsSync(cpuprofilePath)) {
    const files = readdirSync(rawDirectory).filter(
      (f) => f.startsWith(scenario) && f.endsWith('.cpuprofile'),
    )

    if (files.length === 0) {
      throw new Error(`CPU profile not found for scenario "${scenario}" in ${rawDirectory}`)
    }

    return {
      cpuprofilePath: path.join(rawDirectory, files[0]),
      heapprofilePath: path.join(rawDirectory, `${scenario}.heapprofile`),
      traceLogPath,
    }
  }

  return {
    cpuprofilePath,
    heapprofilePath: path.join(rawDirectory, `${scenario}.heapprofile`),
    traceLogPath,
  }
}

// ---------------------------------------------------------------------------
// Source-map frame resolution (shared by CPU and heap profile parsers)
// ---------------------------------------------------------------------------

interface ResolvedFrame {
  functionName: string
  originalColumn: number // 1-based
  originalLine: number // 1-based
  originalSource: string // repo-relative path
}

function resolveFrame(
  callFrame: { columnNumber: number; functionName: string; lineNumber: number; url: string },
  bundlePath: string,
  sourceMap: SourceMap,
): ResolvedFrame | undefined {
  if (!callFrame.url.endsWith(path.basename(bundlePath))) {
    return undefined
  }

  const entry = sourceMap.findEntry(callFrame.lineNumber, callFrame.columnNumber)

  if (!('originalSource' in entry) || entry.originalSource === undefined) {
    return undefined
  }

  assert(typeof entry.originalSource === 'string')
  assert(typeof entry.originalLine === 'number')
  assert(typeof entry.originalColumn === 'number')

  let originalSource: string = entry.originalSource

  const sourceIndex = originalSource.indexOf('/src/')
  if (sourceIndex !== -1) {
    originalSource = originalSource.slice(sourceIndex + 1)
  } else if (originalSource.includes('node_modules')) {
    return undefined
  } else {
    const absPath = path.resolve(path.dirname(bundlePath), originalSource)
    const relativePath = path.relative(config.root, absPath)
    originalSource = relativePath.startsWith('.') ? originalSource : relativePath
  }

  return {
    functionName: callFrame.functionName !== '' ? callFrame.functionName : '(anonymous)',
    originalColumn: entry.originalColumn + 1,
    originalLine: entry.originalLine + 1,
    originalSource,
  }
}

function isProjectSource(source: string): boolean {
  return source.startsWith('src/') && !source.includes('node_modules')
}

function locationString(frame: ResolvedFrame): string {
  return `${frame.originalSource}:${frame.originalLine}:${frame.originalColumn}`
}

// ---------------------------------------------------------------------------
// CPU profile parsing
// ---------------------------------------------------------------------------

interface CPUProfileNode {
  callFrame: {
    columnNumber: number
    functionName: string
    lineNumber: number
    scriptId: string
    url: string
  }
  hitCount: number
  id: number
  children?: number[]
}

interface CPUProfile {
  endTime: number
  nodes: CPUProfileNode[]
  samples: number[]
  startTime: number
  timeDeltas: number[]
}

interface FrameAggregate {
  functionName: string
  location: string
  selfTime: number // microseconds
  totalHits: number
}

interface CPUProfileResult {
  frames: Map<string, FrameAggregate>
  gcTimeUs: number
  totalTime: number
}

function parseCPUProfile(
  profilePath: string,
  bundlePath: string,
  sourceMap: SourceMap,
): CPUProfileResult {
  const raw = JSON.parse(readFileSync(profilePath, 'utf-8')) as CPUProfile
  const nodeById = new Map<number, CPUProfileNode>()

  for (const node of raw.nodes) {
    nodeById.set(node.id, node)
  }

  // Find the (garbage collector) synthetic node
  const gcNode = raw.nodes.find((n) => n.callFrame.functionName === '(garbage collector)')
  const gcNodeId = gcNode?.id

  // Compute self time from samples + timeDeltas
  const selfTimeById = new Map<number, number>()
  let gcTimeUs = 0

  for (let index = 0; index < raw.samples.length; index++) {
    const nodeId = raw.samples[index]
    const delta = raw.timeDeltas[index]
    selfTimeById.set(nodeId, (selfTimeById.get(nodeId) ?? 0) + delta)

    if (nodeId === gcNodeId) {
      gcTimeUs += delta
    }
  }

  const totalTime = raw.timeDeltas.reduce((sum, d) => sum + d, 0)

  // Aggregate by resolved source location
  const frames = new Map<string, FrameAggregate>()

  for (const [nodeId, selfTime] of selfTimeById.entries()) {
    const node = nodeById.get(nodeId)!
    const resolved = resolveFrame(node.callFrame, bundlePath, sourceMap)

    if (resolved === undefined) continue

    const key = `${resolved.functionName}|${resolved.originalSource}|${resolved.originalLine}|${resolved.originalColumn}`
    const loc = locationString(resolved)
    const existing = frames.get(key)

    if (existing !== undefined) {
      existing.selfTime += selfTime
      existing.totalHits += node.hitCount
    } else {
      frames.set(key, {
        functionName: resolved.functionName,
        location: loc,
        selfTime,
        totalHits: node.hitCount,
      })
    }
  }

  return { frames, gcTimeUs, totalTime }
}

// ---------------------------------------------------------------------------
// Heap profile parsing
// ---------------------------------------------------------------------------

interface HeapProfileNode {
  callFrame: {
    columnNumber: number
    functionName: string
    lineNumber: number
    scriptId: string
    url: string
  }
  children: HeapProfileNode[]
  id: number
  selfSize: number
}

interface HeapProfile {
  head: HeapProfileNode
  samples: Array<{ nodeId: number; ordinal: number; size: number }>
}

interface AllocAggregate {
  allocatedBytes: number
  functionName: string
  location: string
}

function parseHeapProfile(
  profilePath: string,
  bundlePath: string,
  sourceMap: SourceMap,
): Map<string, AllocAggregate> {
  const raw = JSON.parse(readFileSync(profilePath, 'utf-8')) as HeapProfile
  const aggregates = new Map<string, AllocAggregate>()

  // Walk the call-frame tree and aggregate selfSize per resolved location
  function walkTree(node: HeapProfileNode): void {
    if (node.selfSize > 0) {
      const resolved = resolveFrame(node.callFrame, bundlePath, sourceMap)

      if (resolved !== undefined && isProjectSource(resolved.originalSource)) {
        const key = `${resolved.functionName}|${resolved.originalSource}|${resolved.originalLine}|${resolved.originalColumn}`
        const existing = aggregates.get(key)

        if (existing !== undefined) {
          existing.allocatedBytes += node.selfSize
        } else {
          aggregates.set(key, {
            allocatedBytes: node.selfSize,
            functionName: resolved.functionName,
            location: locationString(resolved),
          })
        }
      }
    }

    for (const child of node.children) {
      walkTree(child)
    }
  }

  walkTree(raw.head)

  // Also aggregate from the samples array for better coverage
  const nodeById = new Map<number, HeapProfileNode>()

  function indexNodes(node: HeapProfileNode): void {
    nodeById.set(node.id, node)

    for (const child of node.children) {
      indexNodes(child)
    }
  }

  indexNodes(raw.head)

  for (const sample of raw.samples) {
    const node = nodeById.get(sample.nodeId)
    if (node === undefined) continue

    const resolved = resolveFrame(node.callFrame, bundlePath, sourceMap)
    if (resolved === undefined || !isProjectSource(resolved.originalSource)) continue

    const key = `${resolved.functionName}|${resolved.originalSource}|${resolved.originalLine}|${resolved.originalColumn}`
    const existing = aggregates.get(key)

    if (existing !== undefined) {
      // selfSize already captured from tree walk; add sample sizes not in tree
      // The samples array may overlap with tree selfSize; use max to avoid double-counting
    } else {
      aggregates.set(key, {
        allocatedBytes: sample.size,
        functionName: resolved.functionName,
        location: locationString(resolved),
      })
    }
  }

  return aggregates
}

// ---------------------------------------------------------------------------
// Deopt log parsing
// ---------------------------------------------------------------------------

interface DeoptEntry {
  count: number
  functionName: string
  reason: string
}

function parseDeoptLog(logPath: string): DeoptEntry[] {
  if (!existsSync(logPath)) return []

  const content = readFileSync(logPath, 'utf-8')
  const deoptCounts = new Map<string, { count: number; reason: string }>()

  for (const line of content.split('\n')) {
    const deoptMatch = /\[deoptimizing\s+\([^)]*\):[^<]*<(\S+)>/.exec(line)
    const reasonMatch = /reason:\s*([^[\]]+)/.exec(line)

    if (deoptMatch === null || reasonMatch === null) continue

    const functionName = deoptMatch[1]
    const reason = reasonMatch[1].trim()
    const key = `${functionName}|${reason}`
    const existing = deoptCounts.get(key)

    if (existing !== undefined) {
      existing.count += 1
    } else {
      deoptCounts.set(key, { count: 1, reason })
    }
  }

  return [...deoptCounts.entries()]
    .map(([key, { count, reason }]) => ({
      count,
      functionName: key.split('|')[0],
      reason,
    }))
    .sort((a, b) => b.count - a.count)
}

// ---------------------------------------------------------------------------
// Scenario result + delta types
// ---------------------------------------------------------------------------

interface ScenarioResult {
  allocFrames: Map<string, AllocAggregate>
  cpuprofilePath: string
  deopts: DeoptEntry[]
  frames: Map<string, FrameAggregate>
  gcTimeUs: number
  heapprofilePath: string
  scenario: string
  totalTime: number
  traceLogPath: string
}

interface DeltaFrame {
  allocDeltaBytes: number
  functionName: string
  location: string
  selfTimeDelta: number // microseconds per operation
}

function computeDelta(
  later: ScenarioResult,
  earlier: ScenarioResult,
  iterations: number,
): DeltaFrame[] {
  // Collect all project-frame keys from both CPU and allocation data
  const allKeys = new Set<string>()

  for (const [key, frame] of later.frames.entries()) {
    if (isProjectSource(frame.location.split(':')[0])) {
      allKeys.add(key)
    }
  }

  for (const key of later.allocFrames.keys()) {
    allKeys.add(key)
  }

  const result: DeltaFrame[] = []

  for (const key of allKeys) {
    const laterFrame = later.frames.get(key)
    const earlierFrame = earlier.frames.get(key)
    const laterAlloc = later.allocFrames.get(key)
    const earlierAlloc = earlier.allocFrames.get(key)

    const timeDelta = (laterFrame?.selfTime ?? 0) - (earlierFrame?.selfTime ?? 0)
    const allocDelta = (laterAlloc?.allocatedBytes ?? 0) - (earlierAlloc?.allocatedBytes ?? 0)

    if (timeDelta > 0 || allocDelta > 0) {
      const frame = laterFrame ?? laterAlloc
      assert(frame !== undefined)

      result.push({
        allocDeltaBytes: Math.max(0, allocDelta) / iterations,
        functionName: frame.functionName,
        location: frame.location,
        selfTimeDelta: Math.max(0, timeDelta) / iterations,
      })
    }
  }

  return result.sort((a, b) => b.selfTimeDelta - a.selfTimeDelta)
}

// ---------------------------------------------------------------------------
// Ranking model
// ---------------------------------------------------------------------------

interface RankedTarget {
  allocBytesPerOp: number
  attributedCostUs: number
  deltaSource: string
  deoptSignals: string
  functionName: string
  location: string
  rank: number
}

function rankTargets(
  deltas: Array<{ frames: DeltaFrame[]; name: string }>,
  allDeopts: DeoptEntry[],
): RankedTarget[] {
  const deoptByFunction = new Map<string, number>()
  const deoptReasonByFunction = new Map<string, string[]>()

  for (const d of allDeopts) {
    deoptByFunction.set(d.functionName, (deoptByFunction.get(d.functionName) ?? 0) + d.count)
    const reasons = deoptReasonByFunction.get(d.functionName) ?? []
    if (!reasons.includes(d.reason)) reasons.push(d.reason)
    deoptReasonByFunction.set(d.functionName, reasons)
  }

  const maxDeopt = Math.max(1, ...deoptByFunction.values())

  // Merge all delta frames, summing costs across delta categories
  const merged = new Map<
    string,
    {
      allocBytes: number
      functionName: string
      location: string
      sources: string[]
      totalCost: number
    }
  >()

  for (const { frames, name } of deltas) {
    for (const f of frames) {
      const key = `${f.functionName}|${f.location}`
      const existing = merged.get(key)

      if (existing !== undefined) {
        existing.totalCost += f.selfTimeDelta
        existing.allocBytes += f.allocDeltaBytes
        if (!existing.sources.includes(name)) existing.sources.push(name)
      } else {
        merged.set(key, {
          allocBytes: f.allocDeltaBytes,
          functionName: f.functionName,
          location: f.location,
          sources: [name],
          totalCost: f.selfTimeDelta,
        })
      }
    }
  }

  const maxAlloc = Math.max(1, ...[...merged.values()].map((entry) => entry.allocBytes))

  // score = attributedCost × (1 + deoptPenalty + allocPenalty)
  // deoptPenalty = 0.5 × (deoptCount / maxDeopt)
  // allocPenalty = 0.5 × (allocBytes / maxAlloc)
  const scored = [...merged.values()].map((entry) => {
    const deoptCount = deoptByFunction.get(entry.functionName) ?? 0
    const deoptPenalty = 0.5 * (deoptCount / maxDeopt)
    const allocPenalty = 0.5 * (entry.allocBytes / maxAlloc)
    const score = entry.totalCost * (1 + deoptPenalty + allocPenalty)
    const reasons = deoptReasonByFunction.get(entry.functionName) ?? []

    return {
      allocBytesPerOp: entry.allocBytes,
      attributedCostUs: entry.totalCost,
      deltaSource: entry.sources.join(', '),
      deoptSignals: deoptCount > 0 ? `${deoptCount}× deopt (${reasons.join(', ')})` : 'none',
      functionName: entry.functionName,
      location: entry.location,
      score,
    }
  })

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, 20).map((entry, index) => ({
    allocBytesPerOp: entry.allocBytesPerOp,
    attributedCostUs: entry.attributedCostUs,
    deltaSource: entry.deltaSource,
    deoptSignals: entry.deoptSignals,
    functionName: entry.functionName,
    location: entry.location,
    rank: index + 1,
  }))
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function formatUs(us: number): string {
  if (us >= 1000) return `${(us / 1000).toFixed(2)} ms`
  return `${us.toFixed(2)} µs`
}

function formatBytesPerOp(bytes: number): string {
  // Values are per-operation from sampled heap profiling, so typically fractional.
  // Show as bytes per 1k operations for readability.
  const perKOp = bytes * 1000

  if (perKOp >= 1024) return `${(perKOp / 1024).toFixed(1)} KB/kop`
  if (perKOp >= 1) return `${perKOp.toFixed(0)} B/kop`
  return `—`
}

function generateReadingGuide(): string {
  const lines: string[] = []

  lines.push('# Reading this profile report')
  lines.push('')
  lines.push('## What the columns mean')
  lines.push('')
  lines.push('- **Cost/op**: attributed CPU self-time per operation, computed by')
  lines.push('  differencing adjacent scenarios. This is the time the function')
  lines.push("  itself spends on-CPU, not including callees. Higher means the function's")
  lines.push('  own logic is expensive.')
  lines.push('- **Alloc/kop**: attributed allocation volume per 1,000 operations from the')
  lines.push('  V8 sampling heap profiler (statistical sampling — values are approximate).')
  lines.push('  Higher means the function creates more short-lived objects, which drives')
  lines.push('  GC pressure (visible in the GC % column of the scenario timings).')
  lines.push('  "—" means no sampled allocations were attributed to this function.')
  lines.push('- **Deopt signals**: number of V8 deoptimization events observed for the')
  lines.push('  function, with the deopt reason. "none" means V8 successfully optimized')
  lines.push('  this function and kept it optimized throughout the run.')
  lines.push('- **Delta source**: which MECE cost bucket(s) the function contributes to')
  lines.push('  (construction, draft-step, commit-replay).')
  lines.push('')
  lines.push('## How to interpret the ranking')
  lines.push('')
  lines.push('The ranking formula is:')
  lines.push('')
  lines.push('```')
  lines.push('score = cost_per_op × (1 + deopt_penalty + alloc_penalty)')
  lines.push('```')
  lines.push('')
  lines.push('This means a function ranks high when it is CPU-expensive *and* has')
  lines.push('additional deoptimization or allocation pressure. A function with high')
  lines.push('Cost/op but zero Alloc/kop and no deopts ranks on CPU time alone. A function')
  lines.push('with moderate CPU time but heavy allocation gets boosted because its')
  lines.push('allocations cause GC pauses that affect overall throughput.')
  lines.push('')
  lines.push('## What to do about each signal')
  lines.push('')
  lines.push('**High Cost/op, low Alloc/kop (CPU-bound)**')
  lines.push('')
  lines.push('The function does expensive computation without allocating much. Look at')
  lines.push('the implementation for:')
  lines.push('')
  lines.push('- Unnecessary key enumeration (`Reflect.ownKeys`, `Object.keys`) in hot loops')
  lines.push('- Repeated property lookups that could be hoisted')
  lines.push('- Structural traversal (recursive walks, per-key diffing) where a')
  lines.push('  fast-path for known-simple shapes would skip most of the work')
  lines.push('- Redundant comparisons (`Object.is` per field when only one field changed)')
  lines.push('')
  lines.push('**High Alloc/kop (allocation-bound)**')
  lines.push('')
  lines.push('The function creates objects on every call that become garbage shortly')
  lines.push('after. Each allocation contributes to Scavenge (young-generation GC)')
  lines.push('pauses. To reduce:')
  lines.push('')
  lines.push('- Reuse or pool objects instead of allocating new ones per operation')
  lines.push('  (e.g. a shared action-info buffer instead of a fresh `{ payload, source,')
  lines.push('  target, type }` per dispatch)')
  lines.push('- Avoid intermediate object creation (e.g. cloning a `{ count: number }`')
  lines.push('  context via the generic `snapshot()` path when a one-field copy suffices)')
  lines.push('- Reduce the number of allocations on the commit-replay path where both')
  lines.push('  the reducer result and the reconciled output are allocated')
  lines.push('')
  lines.push('**Deopt signals present**')
  lines.push('')
  lines.push('V8 compiled the function with optimizations but had to bail out (deopt).')
  lines.push('Repeated deopts mean the function gets recompiled and deoptimized in a')
  lines.push('loop, losing optimized-code benefits. Common causes:')
  lines.push('')
  lines.push('- Hidden-class (map) transitions: changing the set of properties on an')
  lines.push('  object after creation, or creating objects with properties in different')
  lines.push('  orders across calls')
  lines.push('- Polymorphic call sites: the same property access or function call sees')
  lines.push('  objects with different hidden classes, causing inline-cache misses')
  lines.push('- Type confusion: a variable holds different types across iterations')
  lines.push('  (e.g. `undefined` on first call, object on subsequent calls)')
  lines.push('')
  lines.push('Fix by ensuring objects created in hot loops have a stable, predictable')
  lines.push('shape: same properties, same order, same types. Avoid optional properties')
  lines.push('that are sometimes present, sometimes absent.')
  lines.push('')
  lines.push('**High GC % in scenario timings**')
  lines.push('')
  lines.push('When a scenario shows a high GC percentage (>10%), a significant fraction')
  lines.push('of wall-clock time is spent in garbage collection rather than application')
  lines.push('code. The GC delta row in the delta attribution table tells you which')
  lines.push('lifecycle phase drives the GC pressure. Focus allocation reduction efforts')
  lines.push('on the functions ranked in that delta.')
  lines.push('')

  return lines.join('\n')
}

function generateReport(
  results: Map<string, ScenarioResult>,
  ranked: RankedTarget[],
  deltaResults: Map<string, DeltaFrame[]>,
  analysisJsonPath: string,
  readingGuidePath: string,
): string {
  const perOp = (r: ScenarioResult) => r.totalTime / config.iterations

  const lines: string[] = []

  lines.push('# Draft profiling report')
  lines.push('')

  // 1. Scenario timings (with GC columns)
  lines.push('## Scenario timings')
  lines.push('')
  lines.push('| Scenario | Total time | Per-op | GC time | GC % |')
  lines.push('| --- | --- | --- | --- | --- |')

  for (const { name } of config.scenarios) {
    const r = results.get(name)!
    const gcPercent = r.totalTime > 0 ? (100 * r.gcTimeUs) / r.totalTime : 0
    lines.push(
      `| ${name} | ${formatUs(r.totalTime)} | ${formatUs(perOp(r))} | ${formatUs(r.gcTimeUs)} | ${gcPercent.toFixed(1)}% |`,
    )
  }

  lines.push('')

  // 3. Delta attribution
  lines.push('## Delta attribution (MECE)')
  lines.push('')
  lines.push('| Delta | Per-op cost | GC delta |')
  lines.push('| --- | --- | --- |')

  for (const delta of config.deltas) {
    const laterResult = results.get(delta.later)!
    const earlierResult = results.get(delta.earlier)!
    const cost = perOp(laterResult) - perOp(earlierResult)
    const gcDelta = (laterResult.gcTimeUs - earlierResult.gcTimeUs) / config.iterations
    lines.push(`| ${delta.label} | ${formatUs(cost)} | ${formatUs(gcDelta)} |`)
  }

  lines.push('')

  for (const delta of config.deltas) {
    const frames = deltaResults.get(delta.name)!
    lines.push(`### ${delta.label}`)
    lines.push('')

    if (frames.length === 0) {
      lines.push('No project-level frames with positive delta.')
      lines.push('')
      continue
    }

    lines.push('| Function | Location | Self-time Δ/op | Alloc Δ/kop |')
    lines.push('| --- | --- | --- | --- |')

    for (const f of frames.slice(0, 10)) {
      lines.push(
        `| ${f.functionName} | ${f.location} | ${formatUs(f.selfTimeDelta)} | ${formatBytesPerOp(f.allocDeltaBytes)} |`,
      )
    }

    lines.push('')
  }

  // 4. Ranked optimization targets
  lines.push('## Ranked optimization targets')
  lines.push('')
  lines.push('| Rank | Function | Location | Cost/op | Alloc/kop | Deopt signals | Delta source |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')

  for (const t of ranked) {
    lines.push(
      `| ${t.rank} | ${t.functionName} | ${t.location} | ${formatUs(t.attributedCostUs)} | ${formatBytesPerOp(t.allocBytesPerOp)} | ${t.deoptSignals} | ${t.deltaSource} |`,
    )
  }

  lines.push('')

  // 5. Reading guide
  lines.push('## Reading guide')
  lines.push('')
  lines.push(
    `- See \`${path.relative(outputDirectory, readingGuidePath)}\` for metric definitions and interpretation guidance.`,
  )
  lines.push('')

  // 6. Evidence appendix
  lines.push('## Evidence appendix')
  lines.push('')
  lines.push('### Raw profiles')
  lines.push('')

  for (const { name } of config.scenarios) {
    const r = results.get(name)!
    lines.push(`- **${name}**`)
    lines.push(`  - CPU: \`${path.relative(outputDirectory, r.cpuprofilePath)}\``)
    lines.push(`  - Heap: \`${path.relative(outputDirectory, r.heapprofilePath)}\``)
  }

  lines.push('')
  lines.push('### Trace logs')
  lines.push('')

  for (const { name } of config.scenarios) {
    const r = results.get(name)!
    lines.push(`- **${name}**: \`${path.relative(outputDirectory, r.traceLogPath)}\``)
  }

  lines.push('')
  lines.push('### Machine-readable analysis')
  lines.push('')
  lines.push(`- \`${path.relative(outputDirectory, analysisJsonPath)}\``)
  lines.push('')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('Draft profiling workflow')
console.log(`Run ID:  ${runId}`)
console.log(`Output:  ${outputDirectory}`)
console.log('')

// 0. Bundle harness
console.log('  [build] bundling harness with esbuild')
const { bundlePath, sourceMap } = bundleHarness()
console.log(
  `  [run]  ${config.iterations.toLocaleString()} iterations, ${config.warmup.toLocaleString()} warmup`,
)

// 1. Run scenarios and collect profiles
const results = new Map<string, ScenarioResult>()

for (const { name } of config.scenarios) {
  const artifacts = runScenario(name, bundlePath)
  const cpuResult = parseCPUProfile(artifacts.cpuprofilePath, bundlePath, sourceMap)
  const allocFrames = parseHeapProfile(artifacts.heapprofilePath, bundlePath, sourceMap)
  const deopts = parseDeoptLog(artifacts.traceLogPath)

  results.set(name, {
    allocFrames,
    cpuprofilePath: artifacts.cpuprofilePath,
    deopts,
    frames: cpuResult.frames,
    gcTimeUs: cpuResult.gcTimeUs,
    heapprofilePath: artifacts.heapprofilePath,
    scenario: name,
    totalTime: cpuResult.totalTime,
    traceLogPath: artifacts.traceLogPath,
  })
}

console.log('')

// 2. MECE deltas
const deltaResults = new Map<string, DeltaFrame[]>()

for (const delta of config.deltas) {
  const later = results.get(delta.later)
  const earlier = results.get(delta.earlier)
  assert(later !== undefined, `scenario "${delta.later}" not found in results`)
  assert(earlier !== undefined, `scenario "${delta.earlier}" not found in results`)

  deltaResults.set(delta.name, computeDelta(later, earlier, config.iterations))
}

// 3. Rank
const allDeopts = [...results.values()].flatMap((r) => r.deopts)

const ranked = rankTargets(
  config.deltas.map((d) => ({ frames: deltaResults.get(d.name)!, name: d.name })),
  allDeopts,
)

// 4. Write analysis.json
const analysisJsonPath = path.join(outputDirectory, 'analysis.json')
const analysisData = {
  deltas: Object.fromEntries(
    config.deltas.map((d) => [
      d.name,
      (deltaResults.get(d.name) ?? []).slice(0, 20).map((f) => ({
        allocDeltaBytesPerOp: f.allocDeltaBytes,
        functionName: f.functionName,
        location: f.location,
        selfTimeDeltaPerOpUs: f.selfTimeDelta,
      })),
    ]),
  ),
  metadata: {
    commit: commitHash(),
    cpuProfInterval: config.cpuProfInterval,
    heapProfInterval: config.heapProfInterval,
    iterations: config.iterations,
    nodeVersion: nodeVersion(),
    runId,
    warmup: config.warmup,
  },
  ranked: ranked.map((t) => ({
    allocBytesPerOp: t.allocBytesPerOp,
    attributedCostPerOpUs: t.attributedCostUs,
    deltaSource: t.deltaSource,
    deoptSignals: t.deoptSignals,
    functionName: t.functionName,
    location: t.location,
    rank: t.rank,
  })),
  scenarios: Object.fromEntries(
    [...results.entries()].map(([name, r]) => [
      name,
      {
        deoptCount: r.deopts.reduce((sum, d) => sum + d.count, 0),
        gcTimeUs: r.gcTimeUs,
        perOpUs: r.totalTime / config.iterations,
        topFrames: [...r.frames.values()]
          .filter((f) => isProjectSource(f.location.split(':')[0]))
          .sort((a, b) => b.selfTime - a.selfTime)
          .slice(0, 20)
          .map((f) => ({
            functionName: f.functionName,
            location: f.location,
            selfTimePerOpUs: f.selfTime / config.iterations,
            selfTimeUs: f.selfTime,
          })),
        totalTimeUs: r.totalTime,
      },
    ]),
  ),
}

writeFileSync(analysisJsonPath, JSON.stringify(analysisData, null, 2))

// 5. Write reading guide
const readingGuidePath = path.join(outputDirectory, 'reading-this-report.md')
writeFileSync(readingGuidePath, generateReadingGuide())

// 6. Write report.md
const reportPath = path.join(outputDirectory, 'report.md')
const report = generateReport(results, ranked, deltaResults, analysisJsonPath, readingGuidePath)

writeFileSync(reportPath, report)

console.log(`Report:   ${reportPath}`)
console.log(`Guide:    ${readingGuidePath}`)
console.log(`Analysis: ${analysisJsonPath}`)
console.log('Done.')
