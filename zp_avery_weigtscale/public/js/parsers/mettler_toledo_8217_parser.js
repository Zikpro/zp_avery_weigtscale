/**
 * MettlerToledo8217Parser — decodes RS232 frames from Mettler Toledo scales
 * using the MT-8217 / SICS protocol.
 *
 * The MT-8217 protocol is identical in frame structure to the Avery Berkel FX120
 * (the FX120 emulates it). This parser is kept as a separate class because:
 *   1. Future MT scales may have subtle differences (e.g. different decimal counts).
 *   2. The registry maps scale model → parser class, so MT users get MT branding
 *      in logs and error messages rather than Avery branding.
 *   3. Open/Closed principle — extending coverage costs zero changes to existing code.
 *
 * Frame format:
 *   [STX][stability][sign][NNNNN][.][DDD][SP][unit][CR]
 *
 * Identical to AveryBerkelFX120Parser — this class delegates parse work to
 * a shared private helper to avoid code duplication while keeping separate
 * registry identities.
 */
class MettlerToledo8217Parser extends IWeightParser {

	static get protocolId()   { return "mettler_toledo_8217"; }
	static get protocolName() { return "Mettler Toledo 8217"; }

	getFrameTerminator() {
		return new Uint8Array([0x0D]);
	}

	canParse(rawData) {
		return rawData instanceof Uint8Array
			&& rawData.length >= 14
			&& rawData[0] === 0x02;
	}

	parse(rawData) {
		if (!this.canParse(rawData)) {
			throw new ScaleError(
				ScaleErrorCode.PARSE_ERROR,
				`MettlerToledo8217Parser: unexpected frame (length=${rawData?.length})`
			);
		}

		const stabilityByte = rawData[1];
		const stable = stabilityByte === 0x20;

		const text = MettlerToledo8217Parser._bytesToString(rawData);
		const raw  = text.trim();

		const match = raw.match(/^[? ][+-]?(\d+\.\d+)\s+(\w+)$/);

		if (!match) {
			throw new ScaleError(
				ScaleErrorCode.PARSE_ERROR,
				`MettlerToledo8217Parser: cannot extract weight from "${raw}"`
			);
		}

		const value = parseFloat(match[1]);
		const unit  = match[2].toLowerCase();

		if (!isFinite(value)) {
			throw new ScaleError(
				ScaleErrorCode.PARSE_ERROR,
				`MettlerToledo8217Parser: parsed NaN from "${raw}"`
			);
		}

		return new WeightReading({ value, unit, stable, raw });
	}

	static _bytesToString(bytes) {
		let result = "";
		for (let i = 0; i < bytes.length; i++) {
			if (bytes[i] === 0x02) continue;
			if (bytes[i] === 0x0D) break;
			result += String.fromCharCode(bytes[i]);
		}
		return result;
	}
}

window.MettlerToledo8217Parser = MettlerToledo8217Parser;
