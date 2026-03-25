/**
 * Measures TypeScript type-level performance via `tsc --extendedDiagnostics`.
 *
 * Runs the type checker N times (default 5), collects deterministic counters
 * (Types, Instantiations) and timing metrics (Check time, Total time, Memory),
 * then reports median, mean, stddev, and min/max for each.
 *
 * Usage:
 *   pnpm exec tsx scripts/typelevel-perf.ts [--runs N]
 *
 * ## Type-level optimization protocol
 *
 * Iterative, measure-first workflow for reducing type instantiations, memory,
 * and LOC in type-heavy files. Each iteration is a single-variable experiment.
 *
 * ### Setup
 *
 * 1. Run this script to record baseline metrics (Types, Instantiations, Memory).
 * 2. Create a markdown log file (e.g., `typelevel-review.md`) with the baseline
 *    table and an empty iteration log section.
 * 3. Read the target file in full. Identify candidate changes, but do not batch
 *    unrelated changes — each iteration tests one hypothesis.
 *
 * ### Per-iteration loop
 *
 * 1. **Backup.** Copy the target file to `<file>.backup` (overwrite each time),
 *    e.g., `cp src/types.ts src/types.ts.backup`.
 *    Restore is one command: `cp src/types.ts.backup src/types.ts`.
 *
 * 2. **Re-read the file.** Load the current state of the target file before
 *    editing. Do not rely on memory of earlier iterations.
 *
 * 3. **Apply one change.** Make the edit. Keep it focused: one inlining, one
 *    caching pattern, one removal — not several at once.
 *
 * 4. **Validate correctness.** Run `pnpm run typecheck`, `pnpm exec eslint`,
 *    and `pnpm run test`. All three must pass. If any check fails, fix or
 *    restore from backup before continuing.
 *
 * 5. **Measure.** Run this script (`pnpm exec tsx scripts/typelevel-perf.ts`).
 *    Compare Types, Instantiations, and Memory against the previous iteration.
 *    Timing metrics (Check time, Total time) are noisy — use them directionally,
 *    not as the deciding factor.
 *
 * 6. **Decide.** Keep the change if instantiations or memory improved without
 *    significant regression in the other. Revert (restore from backup) if
 *    instantiations or memory regressed. When metrics conflict (e.g., type count
 *    up but instantiations down), prefer instantiations and memory — they reflect
 *    actual checker work and resource cost.
 *
 * 7. **Log.** Append an entry to the iteration log:
 *    - Iteration number and short description of the change.
 *    - Before/after numbers for Types, Instantiations, Memory, LOC.
 *    - Verdict: kept or reverted, with one-line rationale.
 *    Update the "Final" summary table at the top of the log.
 *
 * Repeat until changes yield diminishing returns or no further candidates remain.
 *
 * ### After all iterations
 *
 * Remove the `.backup` file. Record generalized lessons in the log for future
 * reference.
 *
 * ---
 *
 * ## Lessons from type-level optimization
 *
 * Generalizable patterns observed across optimization sessions.
 *
 * ### What works
 *
 * - **`extends infer X` eliminates duplicate sub-expression evaluation.**
 *   When the same type expression appears in multiple positions within a single
 *   type definition, TypeScript may evaluate it separately for each occurrence.
 *   `extends infer X` binds the result once. The savings multiply when the
 *   containing type is itself instantiated many times.
 *
 * - **Mapped-type wrappers on internal types are wasted work.**
 *   `Prettify` (`{ [K in keyof T]: T[K] }`) and similar display-oriented
 *   mapped types force TypeScript to enumerate and reconstruct properties. When
 *   the result is only consumed by other type-level computations — never shown
 *   in a hover or diagnostic — the mapping is pure overhead.
 *
 * - **Pure-alias types can be inlined safely.**
 *   Types like `type A<M> = B<M>` add a cache entry per unique `M` without
 *   changing semantics. Inlining removes the extra layer. Gains are marginal per
 *   alias but compound across a codebase; the readability improvement from less
 *   indirection is often the primary benefit.
 *
 * ### What backfires
 *
 * - **Inlining named types (especially interfaces) into positions where they are
 *   instantiated repeatedly.**
 *   TypeScript caches named-type instantiations by identity + arguments. An
 *   inline `{ a: ...; b: ... }` object literal in a conditional branch is
 *   re-evaluated structurally each time the branch is taken with different
 *   arguments. This applies in distributive conditionals, indexed-access
 *   dispatches, and any other repeatedly-instantiated position.
 *
 * - **`infer` caching when the cached value requires recovery casts.**
 *   `extends infer X` widens `X` to its constraint. If you then need
 *   `X['actions']`, you must cast (`$.Cast`, `as`, etc.) to recover the
 *   narrower type, and each cast creates its own conditional-type
 *   instantiation. TypeScript already caches property-access chains
 *   (`A<M>['state']['actions']`) when the base is itself cached, so manual
 *   `infer` caching is unnecessary and harmful in this case.
 *
 * ### Measurement discipline
 *
 * - **Instantiation count is the primary indicator; type count can mislead.**
 *   Removing a `Prettify` wrapper may increase type count (raw intersections
 *   kept instead of flattened) while reducing instantiations and memory. Types
 *   reflect how many nodes exist; instantiations reflect how much work the
 *   checker does. Memory tracks the real resource cost.
 *
 * - **Test one hypothesis per iteration.**
 *   Batching "obvious" simplifications masks which changes help and which hurt.
 *   Selective revert is the only way to isolate a harmful change within a batch.
 *
 * ### Patterns that are already optimal
 *
 * - **Nested short-circuit conditionals.**
 *   `A extends ... ? never : B extends ... ? never : unknown` evaluates lazily;
 *   TypeScript stops at the first `never`. Flattening into intersections or
 *   parallel checks forces all branches to evaluate.
 *
 * - **`extends infer U ? U extends { ... }` for union distribution.**
 *   Removing `extends infer U` changes semantics: `(A | B) extends { k: infer V }`
 *   checks the whole union, while `U extends { k: infer V }` (after
 *   `extends infer U`) distributes over each member. There is no simpler
 *   equivalent.
 */

import { execFile } from 'node:child_process'
import path from 'node:path'

const rootDirectory = path.resolve(import.meta.dirname, '..')

interface Sample {
  checkTime: number
  instantiations: number
  memory: number
  totalTime: number
  types: number
}

const parseDiagnostics = (stderr: string): Sample => {
  const get = (label: string): number => {
    const re = new RegExp(`^${label}:\\s+(.+)$`, 'm')
    const match = re.exec(stderr)

    if (match === null) {
      throw new Error(`Missing diagnostic field: ${label}`)
    }

    const raw = match[1].trim()

    // Time fields end with 's', memory fields end with 'K', counters are plain integers
    if (raw.endsWith('s')) return Number.parseFloat(raw)
    if (raw.endsWith('K')) return Number.parseInt(raw, 10)

    return Number.parseInt(raw, 10)
  }

  return {
    checkTime: get('Check time'),
    instantiations: get('Instantiations'),
    memory: get('Memory used'),
    totalTime: get('Total time'),
    types: get('Types'),
  }
}

const runTsc = async (): Promise<string> =>
  await new Promise((resolve, reject) => {
    execFile(
      'npx',
      ['tsc', '--noEmit', '--extendedDiagnostics'],
      { cwd: rootDirectory, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = stdout + stderr

        // tsc exits 0 on success; extendedDiagnostics goes to stdout
        if (error !== null && !output.includes('Total time')) {
          reject(new Error(`tsc failed: ${error.message}\n${output}`))
        } else {
          resolve(output)
        }
      },
    )
  })

interface Stats {
  max: number
  mean: number
  median: number
  min: number
  stddev: number
}

const computeStats = (values: number[]): Stats => {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const mean = sorted.reduce((sum, v) => sum + v, 0) / n
  const variance = sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1)
  const mid = Math.floor(n / 2)
  const median = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]

  return {
    max: sorted[n - 1],
    mean,
    median,
    min: sorted[0],
    stddev: Math.sqrt(variance),
  }
}

const formatNumber = (value: number, decimals: number): string =>
  value.toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  })

const parseArguments = (argv: string[]): { runs: number } => {
  let runs = 5
  const index = argv.indexOf('--runs')

  if (index !== -1 && index + 1 < argv.length) {
    runs = Number.parseInt(argv[index + 1], 10)

    if (!Number.isFinite(runs) || runs < 2) {
      throw new Error('--runs must be an integer >= 2')
    }
  }

  return { runs }
}

const main = async () => {
  const { runs } = parseArguments(process.argv.slice(2))

  console.log(`Collecting ${runs} samples...\n`)

  // Warmup run (populates OS caches, JIT, etc.)
  await runTsc()

  const samples: Sample[] = []

  for (let index = 0; index < runs; index++) {
    const output = await runTsc()
    const sample = parseDiagnostics(output)
    samples.push(sample)
    process.stdout.write(
      `  [${index + 1}/${runs}] check ${sample.checkTime}s  total ${sample.totalTime}s  inst ${sample.instantiations}\n`,
    )
  }

  console.log()

  const metrics: Array<{ decimals: number; key: keyof Sample; label: string; unit: string }> = [
    { decimals: 0, key: 'types', label: 'Types', unit: '' },
    { decimals: 0, key: 'instantiations', label: 'Instantiations', unit: '' },
    { decimals: 0, key: 'memory', label: 'Memory', unit: 'K' },
    { decimals: 2, key: 'checkTime', label: 'Check time', unit: 's' },
    { decimals: 2, key: 'totalTime', label: 'Total time', unit: 's' },
  ]

  // Column widths
  const labelWidth = 18
  const colWidth = 14

  const header = [
    'Metric'.padEnd(labelWidth),
    'Median'.padStart(colWidth),
    'Mean'.padStart(colWidth),
    'StdDev'.padStart(colWidth),
    'Min'.padStart(colWidth),
    'Max'.padStart(colWidth),
  ].join('')

  const separator = '─'.repeat(header.length)

  console.log(header)
  console.log(separator)

  for (const { decimals, key, label, unit } of metrics) {
    const values = samples.map((s) => s[key])
    const stats = computeStats(values)

    const fmt = (v: number) => formatNumber(v, decimals) + unit

    const row = [
      label.padEnd(labelWidth),
      fmt(stats.median).padStart(colWidth),
      fmt(stats.mean).padStart(colWidth),
      fmt(stats.stddev).padStart(colWidth),
      fmt(stats.min).padStart(colWidth),
      fmt(stats.max).padStart(colWidth),
    ].join('')

    console.log(row)
  }

  console.log(separator)
  console.log(`\n${runs} samples, 1 warmup run discarded`)

  // Flag deterministic counters that unexpectedly vary
  for (const key of ['types', 'instantiations'] as const) {
    const values = samples.map((s) => s[key])
    const unique = new Set(values)

    if (unique.size > 1) {
      console.warn(`⚠ ${key} varied across runs: ${[...unique].join(', ')}`)
    }
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
