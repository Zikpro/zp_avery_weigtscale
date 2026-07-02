/**
 * AveryBerkelFX120Parser — decodes ENQ/ACK/DC1 handshake frames from the
 * Avery Berkel FX120.
 *
 * Confirmed by hardware test against a physical FX120 (2026-07-01):
 *
 *   Serial settings: 2400 baud, 7 data bits, 1 stop bit, no parity (2400 7N1)
 *
 *   This scale does NOT stream weight continuously. It must be actively
 *   polled with a handshake:
 *
 *     Host  → ENQ (0x05)
 *     Scale → ACK (0x06)
 *     Host  → DC1 (0x11)
 *     Scale → frame
 *
 *   Frame format (9 bytes):
 *     [STX=0x02][STATUS][D1][D2][D3][D4][D5][US=0x1F][ETX=0x03]
 *
 *   STATUS is a bit-flag byte. Bit 5 (0x20) = stable, 0 = unstable/in-motion.
 *
 *   D1–D5 are ASCII digits giving the weight in whole grams. Divide by 1000
 *   to get kg.
 *
 *   Verified sample (226 g weight on the platform):
 *     02 29 30 30 32 32 36 1F 03
 *     STX STATUS  '0' '0' '2' '2' '6'  US  ETX
 *     status 0x29 = 0b00101001 → bit 5 set → stable
 *     digits "00226" → 226 g → 0.226 kg
 *
 *   The ACK byte from the handshake may still be sitting in SerialBuffer
 *   when the frame arrives (it never matches the ETX terminator, so it is
 *   never emitted on its own). parse()/canParse() therefore locate STX
 *   rather than assuming it is byte 0.
 */
class AveryBerkelFX120Parser extends IWeightParser {

	static get protocolId()   { return "avery_berkel_fx120"; }
	static get protocolName() { return "Avery Berkel FX120 (MT-8217)"; }

	/** Bit 5 of the status byte flags a stable reading. */
	static STABLE_BIT = 0x20;

	/** Frame ends at ETX (0x03). */
	getFrameTerminator() {
		return new Uint8Array([0x03]);
	}

	/**
	 * Two-phase handshake the scale requires before it returns a frame.
	 * WeightService writes phase1, waits briefly for the ACK, then writes phase2.
	 */
	requestFrame() {
		return {
			phase1: new Uint8Array([0x05]), // ENQ
			phase2: new Uint8Array([0x11]), // DC1
		};
	}

	/**
	 * Quick heuristic check: an STX byte must be present with at least
	 * 9 bytes remaining from that point (STX + STATUS + 5 digits + US + ETX).
	 */
	canParse(rawData) {
		if (!(rawData instanceof Uint8Array) || rawData.length < 9) return false;
		const stxIndex = AveryBerkelFX120Parser._findStx(rawData);
		return stxIndex !== -1 && (rawData.length - stxIndex) >= 9;
	}

	/**
	 * @param  {Uint8Array} rawData  — may have a leading ACK (0x06) byte from the handshake
	 * @returns {WeightReading}
	 * @throws {ScaleError}
	 */
	parse(rawData) {
		if (!this.canParse(rawData)) {
			throw new ScaleError(
				ScaleErrorCode.PARSE_ERROR,
				`AveryBerkelFX120Parser: unexpected frame (length=${rawData?.length}, ` +
				`hex=${AveryBerkelFX120Parser._toHex(rawData)})`
			);
		}

		const start  = AveryBerkelFX120Parser._findStx(rawData);
		const status = rawData[start + 1];
		const stable = (status & AveryBerkelFX120Parser.STABLE_BIT) !== 0;

		let digits = "";
		for (let i = start + 2; i <= start + 6; i++) {
			digits += String.fromCharCode(rawData[i]);
		}

		const grams = parseInt(digits, 10);

		if (!isFinite(grams)) {
			throw new ScaleError(
				ScaleErrorCode.PARSE_ERROR,
				`AveryBerkelFX120Parser: non-numeric weight digits "${digits}"`
			);
		}

		const value = grams / 1000; // grams -> kg

		return new WeightReading({ value, unit: "kg", stable, raw: digits });
	}

	// -------------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------------

	/** Index of the first STX (0x02) byte, or -1 if absent. */
	static _findStx(rawData) {
		for (let i = 0; i < rawData.length; i++) {
			if (rawData[i] === 0x02) return i;
		}
		return -1;
	}

	static _toHex(bytes) {
		if (!bytes) return "null";
		return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join(" ");
	}
}

window.AveryBerkelFX120Parser = AveryBerkelFX120Parser;
