export const RELEASE_STORE = Symbol('RELEASE_STORE');

/**
 * Reads what versions a member's devices are running.
 *
 * Its own token rather than reusing `PAIRING_SERVICE`, because the telemetry
 * module already imports this one for the release store — injecting the pairing
 * service here would close the loop into a circular dependency.
 */
export const DEVICE_VERSIONS = Symbol('DEVICE_VERSIONS');
