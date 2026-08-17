//#region src/invariant.ts
/** Cordis companion plugin name. */
const name = "dream-incubator-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the store document is validated by
* {@link coerceDocument} at load, every auxiliary request is deadline-wrapped
* and frozen before dispatch, and the pure engine functions (styles, noise,
* material, scan coercion) are covered by unit tests.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register("dsh-dream-incubator", install));
//#endregion
export { apply, inject, name };
