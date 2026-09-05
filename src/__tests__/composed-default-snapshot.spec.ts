import { assert, describe, it, vi } from 'vitest'
import { interpret, stateMachine } from '../index'

interface SharedContext {
  count: number
  self?: SharedContext
}

describe('composed default snapshots', () => {
  it('preserves aliases and cycles across parent, sibling, and nested child slices', () => {
    const shared: SharedContext = { count: 0 }
    shared.self = shared

    const leaf = stateMachine()
      .state('Leaf')
      .initial('Leaf')
      .action('STEP')
      .context(() => ({ value: shared }))
      .transition('Leaf', 'STEP', 'Leaf', (context) => {
        context.value.count++
        return context
      })
      .done()
    const middle = stateMachine()
      .state('Middle')
      .compose('leaf', leaf)
      .initial('Leaf')
      .action('MIDDLE')
      .context(() => ({ alias: shared }))
      .done()
    const right = stateMachine()
      .state('Right')
      .initial('Right')
      .action('RIGHT')
      .context(() => ({ value: shared }))
      .done()
    const service = interpret(
      stateMachine()
        .state('Root')
        .compose('middle', middle)
        .compose('right', right)
        .initial('Leaf')
        .action('ROOT')
        .context(() => ({ alias: shared }))
        .done(),
    )

    const draft = service.draft()
    const nested = draft.draft()

    for (const context of [service.context, draft.context, nested.context]) {
      assert.strictEqual(context.alias, context.middle.alias)
      assert.strictEqual(context.alias, context.middle.leaf.value)
      assert.strictEqual(context.alias, context.right.value)
      assert.strictEqual(context.alias.self, context.alias)
    }
    assert.notStrictEqual(draft.context.alias, service.context.alias)
    assert.notStrictEqual(nested.context.alias, draft.context.alias)

    assert.equal(nested.do('STEP'), true)
    assert.equal(nested.context.alias.count, 1)
    assert.equal(draft.context.alias.count, 0)
    assert.equal(service.context.alias.count, 0)

    nested.commit()
    assert.equal(draft.context.alias.count, 1)
    assert.equal(service.context.alias.count, 0)
    draft.commit()
    assert.equal(service.context.alias.count, 1)
  })

  it('still snapshots default child slices after a custom parent snapshot', () => {
    const child = stateMachine()
      .state('Child')
      .initial('Child')
      .action('STEP')
      .context(() => ({ value: { count: 0 } }))
      .done()
    const snapshotContext = vi.fn((context: { child: { value: { count: number } } }) => ({
      ...context,
    }))
    const service = interpret(
      stateMachine()
        .state('Root')
        .compose('child', child)
        .initial('Root')
        .done({ snapshotContext }),
    )
    const draft = service.draft()

    assert.equal(snapshotContext.mock.calls.length, 1)
    assert.notStrictEqual(draft.context, service.context)
    assert.notStrictEqual(draft.context.child, service.context.child)
    assert.notStrictEqual(draft.context.child.value, service.context.child.value)
    draft.context.child.value.count++
    assert.equal(service.context.child.value.count, 0)
  })

  it('retains a custom descendant snapshot beneath default-policy ancestors', () => {
    const snapshotContext = vi.fn((context: { count: number }) => ({ count: context.count + 1 }))
    const leaf = stateMachine()
      .state('Leaf')
      .initial('Leaf')
      .action('STEP')
      .context(() => ({ count: 0 }))
      .done({ snapshotContext })
    const middle = stateMachine().state('Middle').compose('leaf', leaf).initial('Leaf').done()
    const service = interpret(
      stateMachine().state('Root').compose('middle', middle).initial('Leaf').done(),
    )
    const draft = service.draft()
    const nested = draft.draft()

    assert.equal(snapshotContext.mock.calls.length, 2)
    assert.equal(service.context.middle.leaf.count, 0)
    assert.equal(draft.context.middle.leaf.count, 1)
    assert.equal(nested.context.middle.leaf.count, 2)
  })
})
