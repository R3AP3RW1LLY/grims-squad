/** Injection token for the market reader. Separate file so the module and the controller can both
 * import it without importing each other. */
export const MARKET_STORE = Symbol('MARKET_STORE');
