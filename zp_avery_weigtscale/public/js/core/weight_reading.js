/**
 * WeightReading — immutable value object representing one scale measurement.
 *
 * Why immutable: a reading is a fact about the past. Once the scale returns
 * "1.234 kg stable at T", that fact cannot change. Mutability here would
 * allow callers to silently corrupt readings as they pass through layers.
 *
 * Carries: numeric value, unit, stability flag, raw string, timestamp.
 */
class WeightReading {

	constructor({ value, unit = "kg", stable = true, raw = "", timestamp = new Date() }) {
		if (typeof value !== "number" || !isFinite(value)) {
			throw new TypeError(`WeightReading: value must be a finite number, got ${value}`);
		}

		this._value     = value;
		this._unit      = String(unit).trim() || "kg";
		this._stable    = Boolean(stable);
		this._raw       = String(raw);
		this._timestamp = timestamp instanceof Date ? timestamp : new Date(timestamp);

		Object.freeze(this);
	}

	get value()     { return this._value; }
	get unit()      { return this._unit; }
	get stable()    { return this._stable; }
	get raw()       { return this._raw; }
	get timestamp() { return this._timestamp; }

	/** True when the weight is positive and the scale reports it as stable. */
	isValid() {
		return this._value > 0 && this._stable;
	}

	/** Human-readable form: "~1.234 kg" (unstable) or "1.234 kg" (stable). */
	toString() {
		const prefix = this._stable ? "" : "~";
		return `${prefix}${this._value.toFixed(3)} ${this._unit}`;
	}

	/** Plain object safe to pass to Frappe/Vue without class overhead. */
	toObject() {
		return {
			value     : this._value,
			unit      : this._unit,
			stable    : this._stable,
			raw       : this._raw,
			timestamp : this._timestamp.toISOString(),
		};
	}

	/** Convenience factory — a zero reading used as a safe default. */
	static zero(unit = "kg") {
		return new WeightReading({ value: 0, unit, stable: true, raw: "0" });
	}

	/** Convenience factory — a debug/simulated reading. */
	static simulated(value, unit = "kg") {
		return new WeightReading({ value, unit, stable: true, raw: String(value) });
	}
}

window.WeightReading = WeightReading;
