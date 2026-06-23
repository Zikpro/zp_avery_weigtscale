/**
 * ScaleSimulator — a software-only replacement for SerialManager + Parser.
 *
 * Used when Scale Settings has debug_mode = 1. It simulates realistic scale
 * behaviour: weight fluctuation, stabilisation delay, zero readings, and
 * negative values — so the POS integration can be tested fully without hardware.
 *
 * Simulation model:
 *   - Starts at 90% of target weight.
 *   - Each poll moves 60% of the remaining distance toward target + small noise.
 *   - stable=true after STABLE_AFTER_N_READS consecutive reads within STABLE_THRESHOLD_KG.
 *   - If target is 0, returns zero immediately (tare simulation).
 *
 * Convergence guarantee: with start=0.9×target and step=0.6, the value
 * reaches within STABLE_THRESHOLD_KG (0.010 kg) by poll 4–5 and stays
 * there, giving stable=true by poll 6 — well within MAX_STABLE_POLLS=15.
 */
class ScaleSimulator {

	static STABLE_AFTER_N_READS = 2;      // consecutive settled reads required
	static FLUCTUATION_KG       = 0.002;  // ±noise per poll
	static STABLE_THRESHOLD_KG  = 0.010;  // deviation window for "settled"
	static STEP_FACTOR          = 0.6;    // convergence speed per poll

	constructor(config) {
		// Use != null (not ||) so debug_weight: 0 is treated as zero, not fallback.
		this._target      = config.debug_weight != null ? Number(config.debug_weight) : 1.250;
		this._unit        = config.unit || "kg";
		this._current     = this._target * 0.9; // start close to target
		this._stableCount = 0;
	}

	async getWeight() {
		await ScaleSimulator._delay(120); // realistic RS232 response delay

		if (this._target === 0) {
			return WeightReading.zero(this._unit);
		}

		const noise    = (Math.random() - 0.5) * 2 * ScaleSimulator.FLUCTUATION_KG;
		const step     = (this._target - this._current) * ScaleSimulator.STEP_FACTOR;
		this._current += step + noise;

		const deviation = Math.abs(this._current - this._target);
		const settled   = deviation < ScaleSimulator.STABLE_THRESHOLD_KG;

		this._stableCount = settled ? this._stableCount + 1 : 0;
		const stable      = this._stableCount >= ScaleSimulator.STABLE_AFTER_N_READS;

		const value = Math.max(0, parseFloat(this._current.toFixed(3)));

		return new WeightReading({ value, unit: this._unit, stable, raw: `SIM:${value}` });
	}

	setWeight(newWeight) {
		this._target      = Number(newWeight) ?? 0;
		this._current     = this._target * 0.9;
		this._stableCount = 0;
	}

	static _delay(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

window.ScaleSimulator = ScaleSimulator;
