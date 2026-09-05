# Maintainer boundaries

- Preserve caller control of context representation and policy semantics, including live references, reducer-created copies, arrays, maps, and frozen objects. Do not add restrictions or compensating runtime machinery solely to prevent ordinary JavaScript errors. Distinguish caller/policy compatibility from violations of the library's own guarantees.
- Continuing to mutate a builder after `.done()` is unsupported. Do not add copying, freezing, or builder-instance isolation to protect finalized definitions against that use.
- Subscriber-driven reentrant state/context mutation is unsupported. Do not add event isolation or reentrancy bookkeeping to accommodate it. Subscription removal and discard without cancelling in-progress replay are separate contracts; lifecycle tests do not imply general reentrant mutation support.
- Prioritize dispatch and replay performance. Put validation in types or building/finalization when those stages have the necessary information. Ask before adding hot-path protection for caller-controlled context behavior.

Remove guidance once the same maintainer intent is explicit in public documentation or enforced by the repository.
