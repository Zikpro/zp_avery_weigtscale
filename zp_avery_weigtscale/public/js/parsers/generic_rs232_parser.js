/**
 * GenericRS232Parser — best-effort parser for unknown or unconfigured scales.
 *
 * Many low-cost RS232 scales output a simple numeric string terminated by CR:
 *
 *   "1.234\r"    (bare number)
 *   "+1.234\r"   (signed number)
 *   "1.234 kg\r" (number + unit)
 *   "ST,GS, 1.234kg\r" (some CAS / Digi variants)
 *
 * This parser extracts the first valid float found anywhere in the frame.
 * It makes no assumptions about stability — all readings are reported as
 * stable=true unless the frame contains a known instability marker ("US", "?").
 *
 * Intended use: fallback when no specific parser is registered for a model,
 * or during initial integration of a new scale before writing a dedicated parser.
 *
 * Limitation: this parser cannot distinguish between stable and unstable on
 * most generic scales. If the scale uses the MT-8217 frame structure, use
 * AveryBerkelFX120Parser or MettlerToledo8217Parser instead.
 */
class GenericRS232Parser extends IWeightParser {

	static get protocolId()   { return "generic_rs232"; }
	static get protocolName() { return "Generic RS232"; }

	getFrameTerminator() {
		return new Uint8Array([0x0D]);
	}

	canParse(rawData) {
		// Accept any non-empty byte array — this is the fallback parser
		return rawData instanceof Uint8Array && rawData.length > 0;
	}

	parse(rawData) {
		const text = GenericRS232Parser._bytesToString(rawData);

		// Detect known instability markers
		const stable = !(/US|ST,US|\?/.test(text));

		// Extract the first float-like token from the string
		const match = text.match(/[+-]?\d+\.?\d*/);

		if (!match) {
			throw new ScaleError(
				ScaleErrorCode.PARSE_ERROR,
				`GenericRS232Parser: no numeric value found in "${text}"`
			);
		}

		const value = parseFloat(match[0]);

		if (!isFinite(value)) {
			throw new ScaleError(
				ScaleErrorCode.PARSE_ERROR,
				`GenericRS232Parser: parsed NaN from "${text}"`
			);
		}

		// Try to extract a unit if present (kg, lb, g, oz)
		const unitMatch = text.match(/\b(kg|lb|oz|g)\b/i);
		const unit      = unitMatch ? unitMatch[1].toLowerCase() : "kg";

		return new WeightReading({ value, unit, stable, raw: text.trim() });
	}

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

window.GenericRS232Parser = GenericRS232Parser;
