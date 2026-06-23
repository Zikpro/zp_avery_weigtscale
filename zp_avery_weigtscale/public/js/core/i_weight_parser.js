/**
 * IWeightParser — abstract contract every scale parser must satisfy.
 *
 * Why a base class instead of a plain interface comment:
 * JavaScript has no compile-time interfaces. By throwing in the base class
 * we get a runtime "you forgot to implement X" error with a clear message,
 * rather than a cryptic "undefined is not a function" deep in WeightService.
 *
 * Each concrete parser handles exactly one scale protocol. Adding a new scale
 * means adding one new file that extends this class — no existing code changes.
 *
 * Subclass contract:
 *   static get protocolId()      — unique snake_case string key for the registry
 *   static get protocolName()    — human-readable display name
 *   getFrameTerminator()         — byte sequence that ends a complete frame
 *   canParse(rawData)            — quick sanity check before parse()
 *   parse(rawData)               — converts Uint8Array → WeightReading
 */
class IWeightParser {

	/**
	 * Unique identifier used by ParserRegistry to look up this parser.
	 * Must match the "Protocol" value stored in Scale Settings.
	 * @returns {string}  e.g. "avery_berkel_fx120"
	 */
	static get protocolId() {
		throw new Error(`${this.name} must define static get protocolId()`);
	}

	/**
	 * Human-readable name shown in error messages and logs.
	 * @returns {string}  e.g. "Avery Berkel FX120"
	 */
	static get protocolName() {
		throw new Error(`${this.name} must define static get protocolName()`);
	}

	/**
	 * The byte sequence that marks the end of one complete response frame.
	 * SerialBuffer accumulates bytes until it detects this terminator, then
	 * delivers the full frame to WeightService for parsing.
	 *
	 * Most RS232 scales terminate with CR (0x0D) or CR+LF (0x0D 0x0A).
	 *
	 * @returns {Uint8Array}
	 */
	getFrameTerminator() {
		throw new Error(`${this.constructor.name} must implement getFrameTerminator()`);
	}

	/**
	 * Returns true when this parser believes it can decode the given bytes.
	 * Used by ParserRegistry for protocol auto-detection (future feature).
	 * Must be cheap — no parsing, no allocation beyond a few byte checks.
	 *
	 * @param  {Uint8Array} rawData
	 * @returns {boolean}
	 */
	canParse(rawData) {
		throw new Error(`${this.constructor.name} must implement canParse()`);
	}

	/**
	 * Decodes raw bytes into a WeightReading.
	 *
	 * @param  {Uint8Array} rawData   — complete frame including any header/terminator bytes
	 * @returns {WeightReading}
	 * @throws {ScaleError}           — code PARSE_ERROR on malformed data
	 *                                — code UNSTABLE_WEIGHT if scale flags instability
	 *                                   and the caller configured stable_weight_only
	 */
	parse(rawData) {
		throw new Error(`${this.constructor.name} must implement parse()`);
	}
}

window.IWeightParser = IWeightParser;
