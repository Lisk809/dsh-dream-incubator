/**
 * Package-owned invariant companion for `dsh-dream-incubator`.
 * @module dsh-dream-incubator/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-invariants'

/** Cordis companion plugin name. */
export const name = 'dream-incubator-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the store document is validated by
 * {@link coerceDocument} at load, every auxiliary request is deadline-wrapped
 * and frozen before dispatch, and the pure engine functions (styles, noise,
 * material, scan coercion) are covered by unit tests.
 */
const install = (): void => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('dsh-dream-incubator', install))
