/**
 * ScaleErrorCode — Typed error codes for every failure mode.
 *
 * Why: Silent catch blocks (like Pasigono's //TODO) hide bugs in production.
 * Every failure has a code so callers can make programmatic decisions
 * (retry, show user message, fall back to debug mode) without string matching.
 */
const ScaleErrorCode = Object.freeze({
	// --- Serial API ---
	SERIAL_NOT_SUPPORTED : "SERIAL_NOT_SUPPORTED",  // Browser lacks Web Serial API
	PORT_NOT_SELECTED    : "PORT_NOT_SELECTED",      // User dismissed the port picker
	PORT_ACCESS_DENIED   : "PORT_ACCESS_DENIED",     // OS-level permission denied
	PORT_ALREADY_OPEN    : "PORT_ALREADY_OPEN",      // connect() called on open port
	CONNECTION_FAILED    : "CONNECTION_FAILED",      // port.open() threw
	CONNECTION_LOST      : "CONNECTION_LOST",        // Port disconnected mid-session
	WRITE_FAILED         : "WRITE_FAILED",           // Could not send command
	// --- Reading ---
	READ_TIMEOUT         : "READ_TIMEOUT",           // No frame arrived within deadline
	// --- Parsing ---
	PARSE_ERROR          : "PARSE_ERROR",            // Bytes received but could not decode
	UNSTABLE_WEIGHT      : "UNSTABLE_WEIGHT",        // Scale flagged reading as unstable
	// --- Registry ---
	NO_PARSER_FOUND      : "NO_PARSER_FOUND",        // No parser registered for this model
	// --- Config ---
	INVALID_CONFIG       : "INVALID_CONFIG",         // Scale Settings missing required field
});

/**
 * ScaleError — structured error that carries a typed code and an optional cause.
 *
 * Usage:
 *   throw new ScaleError(ScaleErrorCode.READ_TIMEOUT, "No response within 3s");
 *   throw new ScaleError(ScaleErrorCode.CONNECTION_FAILED, err.message, err);
 *
 * Callers can branch on code without fragile string matching:
 *   if (err.code === ScaleErrorCode.UNSTABLE_WEIGHT) { ... }
 */
class ScaleError extends Error {

	constructor(code, message, cause = null) {
		super(message);
		this.name  = "ScaleError";
		this.code  = code;
		this.cause = cause;
	}

	/**
	 * True when the operation may be retried without user intervention.
	 * False when a human action (reconnect cable, grant permission) is required.
	 */
	isRecoverable() {
		return [
			ScaleErrorCode.READ_TIMEOUT,
			ScaleErrorCode.PARSE_ERROR,
			ScaleErrorCode.UNSTABLE_WEIGHT,
		].includes(this.code);
	}

	toString() {
		return `ScaleError[${this.code}]: ${this.message}`;
	}
}

window.ScaleErrorCode = ScaleErrorCode;
window.ScaleError     = ScaleError;
