/**
 * AveryBerkelFX120Parser — decodes RS232 frames from the Avery Berkel FX120.
 *
 * The FX120 runs in Mettler Toledo 8217 compatibility mode by default.
 * Response to the "W" command:
 *
 *   [STX] [stability] [sign] [NNNNN] [.] [DDD] [SP] [unit] [CR]
 *
 *   Byte 0   : STX (0x02) — start of text marker
 *   Byte 1   : stability  — SPACE (0x20) = stable, "?" (0x3F) = unstable
 *   Byte 2   : sign       — "+" or "-"
 *   Bytes 3–7: integer part, 5 digits zero-padded
 *   Byte 8   : decimal point "."
 *   Bytes 9–11: decimal part, 3 digits
 *   Byte 12  : SPACE
 *   Bytes 13–14: unit ("kg", "lb", " g", "oz")
 *   Byte 15  : CR (0x0D) — frame terminator
 *
 * Example (stable, 1.234 kg):
 *   02 20 2B 30 30 30 30 31 2E 32 33 34 20 6B 67 0D
 *    ^  ^  ^  <-- 00001 --> .  <234>  SP kg  CR
 *   STX SP  +
 *
 * Example (unstable):
 *   02 3F 2B 30 30 30 30 31 2E 32 33 34 20 6B 67 0D
 *        ^
 *        ? = unstable
 */
class AveryBerkelFX120Parser extends IWeightParser {

	static get protocolId()   { return "avery_berkel_fx120"; }
	static get protocolName() { return "Avery Berkel FX120 (MT-8217)"; }

	/** Frame ends at CR (0x0D). */
	getFrameTerminator() {
		return new Uint8Array([0x0D]);
	}

	/**
	 * Quick heuristic check: frame must start with STX and be at least 14 bytes.
	 */
	canParse(rawData) {
		return rawData instanceof Uint8Array
			&& rawData.length >= 14
			&& rawData[0] === 0x02;
	}

	/**
	 * @param  {Uint8Array} rawData
	 * @returns {WeightReading}
	 * @throws {ScaleError}
	 */
	parse(rawData) {
		if (!this.canParse(rawData)) {
			throw new ScaleError(
				ScaleErrorCode.PARSE_ERROR,
				`AveryBerkelFX120Parser: unexpected frame (length=${rawData?.length}, ` +
				`first byte=0x${rawData?.[0]?.toString(16) ?? "?"})`
			);
		}

		// Byte 1: stability flag (read directly from bytes, before any string conversion)
		const stable = rawData[1] === 0x20; // SPACE = stable, '?' = unstable

		// Decode bytes skipping STX, stopping at CR.
		// Result keeps the leading stability char: " +00001.234 kg" or "?+00001.234 kg"
		const text = AveryBerkelFX120Parser._bytesToString(rawData);

		// Match against the full text — do NOT trim first.
		// The leading space is the stability byte; trimming it breaks the regex anchor.
		const match = text.match(/^[? ][+-]?(\d+\.\d+)\s+(\w+)$/);

		if (!match) {
			throw new ScaleError(
				ScaleErrorCode.PARSE_ERROR,
				`AveryBerkelFX120Parser: cannot extract weight from "${text.trim()}"`
			);
		}

		const value = parseFloat(match[1]);
		const unit  = match[2].toLowerCase();

		if (!isFinite(value)) {
			throw new ScaleError(
				ScaleErrorCode.PARSE_ERROR,
				`AveryBerkelFX120Parser: parsed NaN from "${text.trim()}"`
			);
		}

		return new WeightReading({ value, unit, stable, raw: text.trim() });
	}

	// -------------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------------

	/** Convert Uint8Array to ASCII string, skipping STX (0x02) and stopping at CR (0x0D). */
	static _bytesToString(bytes) {
		let result = "";
		for (let i = 0; i < bytes.length; i++) {
			if (bytes[i] === 0x02) continue; // skip STX
			if (bytes[i] === 0x0D) break;    // stop at CR
			result += String.fromCharCode(bytes[i]);
		}
		return result;
	}
}

window.AveryBerkelFX120Parser = AveryBerkelFX120Parser;
