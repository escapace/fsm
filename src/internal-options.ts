import { isObject } from './is-object'

export const resolveOwnOption = (options: unknown, key: string): unknown =>
  isObject(options) && Object.hasOwn(options, key)
    ? (options as Record<string, unknown>)[key]
    : undefined

export const resolveOwnFunctionOption = <TFunction extends (...arguments_: unknown[]) => unknown>(
  options: unknown,
  key: string,
  fallback: TFunction,
): TFunction => {
  const value = resolveOwnOption(options, key)

  return typeof value === 'function' ? (value as TFunction) : fallback
}
