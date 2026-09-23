/**
 * ScaleTestSuite — zero-dependency browser-based test runner.
 *
 * No Jest, no Node, no build step. Open the test page in Chrome/Edge and
 * run ScaleTestSuite.run() in the console. Results print to console and
 * to the DOM element #scale-test-results if it exists.
 *
 * Design: a minimal Arrange-Act-Assert framework that:
 *   - Catches sync and async errors separately from test logic errors.
 *   - Reports which assertion failed, not just "test failed".
 *   - Exits with a summary count so CI can check window.scaleTestsFailed.
 *
 * Usage:
 *   // In browser console (after all scale JS files are loaded):
 *   await ScaleTestSuite.run();
 *   console.log(window.scaleTestsPassed, window.scaleTestsFailed);
 */
class ScaleTestSuite {

	static _tests  = [];
	static _passed = 0;
	static _failed = 0;

	// =========================================================================
	// Minimal assertion library
	// =========================================================================

	static assert = {
		equal(actual, expected, label = "") {
			if (actual !== expected) {
				throw new Error(
					`${label ? label + ": " : ""}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
				);
			}
		},
		throws(fn, expectedCode, label = "") {
			let threw = false;
			try { fn(); } catch (err) {
				threw = true;
				if (expectedCode && err.code !== expectedCode) {
					throw new Error(
						`${label ? label + ": " : ""}expected ScaleError[${expectedCode}], ` +
						`got ${err.code || err.message}`
					);
				}
			}
			if (!threw) throw new Error(`${label ? label + ": " : ""}expected an error to be thrown`);
		},
		async throwsAsync(fn, expectedCode, label = "") {
			let threw = false;
			try { await fn(); } catch (err) {
				threw = true;
				if (expectedCode && err.code !== expectedCode) {
					throw new Error(
						`${label ? label + ": " : ""}expected ScaleError[${expectedCode}], ` +
						`got ${err.code || err.message}`
					);
				}
			}
			if (!threw) throw new Error(`${label ? label + ": " : ""}expected an async error to be thrown`);
		},
		ok(value, label = "") {
			if (!value) throw new Error(`${label ? label + ": " : ""}expected truthy, got ${value}`);
		},
		notOk(value, label = "") {
			if (value) throw new Error(`${label ? label + ": " : ""}expected falsy, got ${value}`);
		},
	};

	// =========================================================================
	// Test registration
	// =========================================================================

	static test(name, fn) {
		ScaleTestSuite._tests.push({ name, fn });
	}

	// =========================================================================
	// Runner
	// =========================================================================

	static async run() {
		ScaleTestSuite._passed = 0;
		ScaleTestSuite._failed = 0;
		const results = [];

		console.group("ScaleTestSuite");

		for (const { name, fn } of ScaleTestSuite._tests) {
			try {
				await fn(ScaleTestSuite.assert);
				ScaleTestSuite._passed++;
				console.log(`  ✓ ${name}`);
				results.push({ name, ok: true });
			} catch (err) {
				ScaleTestSuite._failed++;
				console.error(`  ✗ ${name}\n    ${err.message}`);
				results.push({ name, ok: false, error: err.message });
			}
		}

		const total = ScaleTestSuite._passed + ScaleTestSuite._failed;
		console.log(`\n${ScaleTestSuite._passed}/${total} passed`);
		console.groupEnd();

		window.scaleTestsPassed = ScaleTestSuite._passed;
		window.scaleTestsFailed = ScaleTestSuite._failed;

		ScaleTestSuite._renderDOM(results);

		return ScaleTestSuite._failed === 0;
	}

	static _renderDOM(results) {
		const el = document.getElementById("scale-test-results");
		if (!el) return;
		el.innerHTML = results
			.map(r => `<div style="color:${r.ok ? "green" : "red"}">${r.ok ? "✓" : "✗"} ${r.name}${r.error ? ` — ${r.error}` : ""}</div>`)
			.join("");
	}
}

// =============================================================================
// Test definitions
// =============================================================================

const T  = ScaleTestSuite.test.bind(ScaleTestSuite);
const AS = ScaleTestSuite.assert;

// ─── ScaleError ──────────────────────────────────────────────────────────────

T("ScaleError carries code and message", async (A) => {
	const err = new ScaleError(ScaleErrorCode.READ_TIMEOUT, "timed out");
	A.equal(err.code, ScaleErrorCode.READ_TIMEOUT, "code");
	A.equal(err.message, "timed out", "message");
	A.equal(err.name, "ScaleError", "name");
});

T("ScaleError.isRecoverable() — timeout is recoverable", async (A) => {
	A.ok(new ScaleError(ScaleErrorCode.READ_TIMEOUT, "").isRecoverable());
});

T("ScaleError.isRecoverable() — connection lost is NOT recoverable", async (A) => {
	A.notOk(new ScaleError(ScaleErrorCode.CONNECTION_LOST, "").isRecoverable());
});

// ─── WeightReading ───────────────────────────────────────────────────────────

T("WeightReading stores all fields correctly", async (A) => {
	const r = new WeightReading({ value: 1.234, unit: "kg", stable: true, raw: "raw" });
	A.equal(r.value,  1.234, "value");
	A.equal(r.unit,   "kg",  "unit");
	A.equal(r.stable, true,  "stable");
	A.equal(r.raw,    "raw", "raw");
});

T("WeightReading is frozen (immutable)", async (A) => {
	const r = new WeightReading({ value: 1.0, unit: "kg" });
	try { r._value = 99; } catch {}
	A.equal(r.value, 1.0, "value unchanged after freeze");
});

T("WeightReading.isValid() — positive stable = true", async (A) => {
	A.ok(new WeightReading({ value: 1.0, unit: "kg", stable: true }).isValid());
});

T("WeightReading.isValid() — zero = false", async (A) => {
	A.notOk(new WeightReading({ value: 0, unit: "kg", stable: true }).isValid());
});

T("WeightReading.isValid() — unstable = false", async (A) => {
	A.notOk(new WeightReading({ value: 1.0, unit: "kg", stable: false }).isValid());
});

T("WeightReading.toString() — stable has no prefix", async (A) => {
	const r = new WeightReading({ value: 1.234, unit: "kg", stable: true });
	A.equal(r.toString(), "1.234 kg");
});

T("WeightReading.toString() — unstable has ~ prefix", async (A) => {
	const r = new WeightReading({ value: 1.234, unit: "kg", stable: false });
	A.equal(r.toString(), "~1.234 kg");
});

T("WeightReading rejects non-finite value", async (A) => {
	A.throws(() => new WeightReading({ value: NaN }), null, "NaN rejected");
	A.throws(() => new WeightReading({ value: Infinity }), null, "Infinity rejected");
});

T("WeightReading.zero() factory", async (A) => {
	const r = WeightReading.zero("lb");
	A.equal(r.value, 0);
	A.equal(r.unit, "lb");
});

// ─── SerialBuffer ────────────────────────────────────────────────────────────

T("SerialBuffer emits frame when terminator is in one chunk", async (A) => {
	const buf = new SerialBuffer(new Uint8Array([0x0D]));
	let received = null;
	buf.onFrame(f => received = f);

	buf.push(new Uint8Array([0x02, 0x41, 0x42, 0x0D]));

	A.ok(received !== null, "frame emitted");
	A.equal(received.length, 4, "frame length");
	A.equal(received[0], 0x02, "first byte");
	A.equal(received[3], 0x0D, "terminator byte");
});

T("SerialBuffer emits frame when data arrives in two chunks", async (A) => {
	const buf = new SerialBuffer(new Uint8Array([0x0D]));
	let count = 0;
	buf.onFrame(() => count++);

	buf.push(new Uint8Array([0x02, 0x41]));   // partial
	A.equal(count, 0, "no emit on partial chunk");

	buf.push(new Uint8Array([0x42, 0x0D]));   // completes the frame
	A.equal(count, 1, "one frame emitted after second chunk");
});

T("SerialBuffer emits two frames from one large chunk", async (A) => {
	const buf = new SerialBuffer(new Uint8Array([0x0D]));
	let count = 0;
	buf.onFrame(() => count++);

	// Two frames concatenated
	buf.push(new Uint8Array([0x41, 0x0D, 0x42, 0x0D]));
	A.equal(count, 2, "two frames emitted");
});

T("SerialBuffer.flush() clears state", async (A) => {
	const buf = new SerialBuffer(new Uint8Array([0x0D]));
	let count = 0;
	buf.onFrame(() => count++);

	buf.push(new Uint8Array([0x41, 0x42])); // no terminator yet
	buf.flush();
	buf.push(new Uint8Array([0x0D]));       // terminator after flush — should not emit stale frame
	A.equal(count, 1, "one frame (only the bytes after flush, but with 0D alone it still triggers)");
});

// ─── AveryBerkelFX120Parser ──────────────────────────────────────────────────
// Protocol confirmed by hardware test against a physical FX120 (2026-07-01).
// Frame: STX(02) + STATUS(1B) + 5 ASCII digits(grams) + US(1F) + ETX(03)
// Status bit 5 (0x20): 1 = stable, 0 = unstable.

T("AveryBerkelFX120Parser parses hardware-confirmed stable 226g frame", async (A) => {
	const parser = new AveryBerkelFX120Parser();
	// Confirmed sample: 02 29 30 30 32 32 36 1F 03
	// status 0x29 = 0b00101001 → bit 5 set → stable; digits "00226" → 226g → 0.226 kg
	const bytes = new Uint8Array([0x02, 0x29, 0x30, 0x30, 0x32, 0x32, 0x36, 0x1F, 0x03]);
	const reading = parser.parse(bytes);
	A.equal(reading.value,  0.226, "226g → 0.226 kg");
	A.equal(reading.unit,   "kg",  "unit");
	A.equal(reading.stable, true,  "stable: status bit 5 set");
});

T("AveryBerkelFX120Parser parses unstable frame (status bit 5 = 0)", async (A) => {
	const parser = new AveryBerkelFX120Parser();
	// Status 0x09 = 0b00001001 → bit 5 NOT set → unstable
	const bytes = new Uint8Array([0x02, 0x09, 0x30, 0x30, 0x32, 0x32, 0x36, 0x1F, 0x03]);
	const reading = parser.parse(bytes);
	A.equal(reading.stable, false, "unstable: status bit 5 not set");
	A.equal(reading.value,  0.226, "value still parsed");
});

T("AveryBerkelFX120Parser handles leading ACK byte from handshake", async (A) => {
	const parser = new AveryBerkelFX120Parser();
	// ACK (0x06) arrives before the frame and sits in SerialBuffer.
	// Parser must skip it by locating STX.
	const bytes = new Uint8Array([0x06, 0x02, 0x29, 0x30, 0x30, 0x32, 0x32, 0x36, 0x1F, 0x03]);
	const reading = parser.parse(bytes);
	A.equal(reading.value,  0.226, "correct value with leading ACK");
	A.equal(reading.stable, true,  "stable");
});

T("AveryBerkelFX120Parser.requestFrame() returns ENQ and DC1 handshake bytes", async (A) => {
	const parser = new AveryBerkelFX120Parser();
	const req = parser.requestFrame();
	A.ok(req !== null,            "not null for active-poll protocol");
	A.equal(req.phase1[0], 0x05, "phase1 is ENQ");
	A.equal(req.phase2[0], 0x11, "phase2 is DC1");
});

T("AveryBerkelFX120Parser throws PARSE_ERROR on garbage frame", async (A) => {
	const parser = new AveryBerkelFX120Parser();
	A.throws(
		() => parser.parse(new Uint8Array([0xFF, 0x00, 0x01])),
		ScaleErrorCode.PARSE_ERROR,
		"garbage frame"
	);
});

T("AveryBerkelFX120Parser.canParse() rejects frame without STX", async (A) => {
	const parser = new AveryBerkelFX120Parser();
	A.notOk(parser.canParse(new Uint8Array([0x06, 0x29, 0x30, 0x30])));
});

// ─── GenericRS232Parser ──────────────────────────────────────────────────────

T("GenericRS232Parser extracts bare number", async (A) => {
	const parser = new GenericRS232Parser();
	const bytes  = new TextEncoder().encode("1.234\r");
	const reading = parser.parse(new Uint8Array(bytes.buffer));
	A.equal(reading.value, 1.234);
	A.equal(reading.unit,  "kg");
	A.equal(reading.stable, true);
});

T("GenericRS232Parser detects instability marker 'US'", async (A) => {
	const parser = new GenericRS232Parser();
	const bytes  = new TextEncoder().encode("ST,US, 0.987kg\r");
	const reading = parser.parse(new Uint8Array(bytes.buffer));
	A.equal(reading.stable, false, "US marker = unstable");
	A.equal(reading.value,  0.987);
});

T("GenericRS232Parser throws PARSE_ERROR on non-numeric frame", async (A) => {
	const parser = new GenericRS232Parser();
	A.throws(
		() => parser.parse(new TextEncoder().encode("NO WEIGHT\r")),
		ScaleErrorCode.PARSE_ERROR
	);
});

// ─── ParserRegistry ──────────────────────────────────────────────────────────

T("ParserRegistry.resolve() returns AveryBerkelFX120Parser by protocolId", async (A) => {
	const parser = ParserRegistry.resolve("avery_berkel_fx120");
	A.ok(parser instanceof AveryBerkelFX120Parser);
});

T("ParserRegistry.resolve() returns MettlerToledo8217Parser by name", async (A) => {
	const parser = ParserRegistry.resolve("Mettler Toledo 8217");
	A.ok(parser instanceof MettlerToledo8217Parser);
});

T("ParserRegistry.resolve() falls back to GenericRS232Parser for unknown id", async (A) => {
	const parser = ParserRegistry.resolve("some_unknown_scale_2099");
	A.ok(parser instanceof GenericRS232Parser, "fallback to generic");
});

T("ParserRegistry.list() includes all registered parsers", async (A) => {
	const ids = ParserRegistry.list();
	A.ok(ids.includes("avery_berkel_fx120"),    "avery registered");
	A.ok(ids.includes("mettler_toledo_8217"),   "mettler registered");
	A.ok(ids.includes("generic_rs232"),         "generic registered");
});

// ─── ScaleSimulator ──────────────────────────────────────────────────────────

T("ScaleSimulator eventually returns a stable reading", async (A) => {
	const sim = new ScaleSimulator({ debug_weight: 2.500, unit: "kg" });
	let stableReading = null;

	for (let i = 0; i < 20; i++) {
		const r = await sim.getWeight();
		if (r.stable) { stableReading = r; break; }
	}

	A.ok(stableReading !== null, "stable reading arrived within 20 polls");
	A.ok(stableReading.value > 0, "value is positive");
});

T("ScaleSimulator returns zero reading when target is 0", async (A) => {
	const sim = new ScaleSimulator({ debug_weight: 0, unit: "kg" });
	const r   = await sim.getWeight();
	A.equal(r.value,  0,    "value is 0");
	A.equal(r.stable, true, "zero is always stable");
});

T("ScaleSimulator.setWeight() changes the simulated target", async (A) => {
	const sim = new ScaleSimulator({ debug_weight: 1.0, unit: "kg" });
	sim.setWeight(5.0);

	let stableReading = null;
	for (let i = 0; i < 20; i++) {
		const r = await sim.getWeight();
		if (r.stable) { stableReading = r; break; }
	}

	A.ok(stableReading !== null, "converged");
	A.ok(Math.abs(stableReading.value - 5.0) < 0.05, `value near 5kg, got ${stableReading.value}`);
});

// ─── WeightService polling: ACK handling and timeouts ────────────────────────
//
// These exercise the real WeightService → SerialManager → SerialBuffer →
// AveryBerkelFX120Parser flow with only the physical SerialPort replaced by
// FakeFX120Port. They require fx120_mock_port.js to be loaded first.

const FX_CONFIG = {
	enabled            : 1,
	scale_model        : "Avery Berkel FX120",
	baud_rate          : 2400,
	data_bits          : 7,
	stop_bits          : 1,
	parity             : "None",
	stable_weight_only : 0,
	read_interval      : 120,
};

/** Wire a FakeFX120Port up to a real WeightService and connect it. */
async function fxSetup(portOpts = {}, configOverrides = {}, parser = null) {
	const writes = [];
	const port = new FakeFX120Port({
		weight : 1250,
		status : 0x29, // bit 5 set → stable
		log    : (line) => writes.push(line),
		...portOpts,
	});
	installFakeSerial(port);

	const service = new WeightService(
		{ ...FX_CONFIG, ...configOverrides },
		parser || ParserRegistry.resolve(FX_CONFIG.scale_model),
		false,
	);
	await service.connect();

	return {
		port,
		service,
		/** True when DC1 (0x11) was written to the scale at least once. */
		sawDc1: () => writes.some(l => l.includes("POS -> Scale: [11]")),
		writes,
	};
}

const fxDelay = (ms) => new Promise(r => setTimeout(r, ms));

/** Poll `fn` until it returns truthy, or give up. Avoids brittle fixed waits. */
async function fxWaitUntil(fn, timeoutMs = 5000) {
	const t0 = performance.now();
	while (performance.now() - t0 < timeoutMs) {
		if (fn()) return true;
		await fxDelay(20);
	}
	return false;
}

T("A. Normal ACK → DC1 → frame parses the weight", async (A) => {
	const { service, sawDc1 } = await fxSetup({ weight: 1250 });
	try {
		const reading = await service.getWeight();
		A.equal(reading.value,  1.25, "weight parsed from frame");
		A.equal(reading.stable, true, "status bit 5 reports stable");
		A.ok(sawDc1(), "DC1 was sent after the ACK");
	} finally {
		await service.disconnect();
	}
});

T("B. Missing ACK skips DC1 and ends the poll without the frame backstop", async (A) => {
	const { port, service, sawDc1 } = await fxSetup();
	try {
		port.dropNextAck();

		const t0 = performance.now();
		await A.throwsAsync(
			() => service.getWeight(),
			ScaleErrorCode.READ_TIMEOUT,
			"poll rejects when no ACK arrives",
		);
		const elapsed = performance.now() - t0;

		A.notOk(sawDc1(), "DC1 must not be sent when the ACK was missed");
		// Without the immediate-fail path this would run to READ_TIMEOUT_MS.
		// It should instead end at the ACK wait (~300ms).
		A.ok(
			elapsed < 500,
			`poll ended in ${elapsed.toFixed(0)}ms, not the ${WeightService.READ_TIMEOUT_MS}ms backstop`,
		);
	} finally {
		await service.disconnect();
	}
});

T("C. The poll after a missed ACK retries and succeeds", async (A) => {
	const { port, service } = await fxSetup({ weight: 764 });
	try {
		port.dropNextAck();
		await A.throwsAsync(() => service.getWeight(), ScaleErrorCode.READ_TIMEOUT, "first poll misses");

		const reading = await service.getWeight();
		A.equal(reading.value,  0.764, "next poll returns the weight");
		A.equal(reading.stable, true,  "and it is stable");
	} finally {
		await service.disconnect();
	}
});

T("D. A frame that never arrives after DC1 fails on the ~600ms backstop", async (A) => {
	// ACK normally, but delay the frame far beyond the backstop.
	const { service, sawDc1 } = await fxSetup({ frameDelayMs: 5000 });
	try {
		const t0 = performance.now();
		await A.throwsAsync(
			() => service.getWeight(),
			ScaleErrorCode.READ_TIMEOUT,
			"poll rejects when the frame never arrives",
		);
		const elapsed = performance.now() - t0;

		A.ok(sawDc1(), "DC1 was sent — this is the real backstop path");
		A.ok(
			elapsed >= WeightService.READ_TIMEOUT_MS - 120,
			`waited for the backstop, got ${elapsed.toFixed(0)}ms`,
		);
		A.ok(
			elapsed < WeightService.READ_TIMEOUT_MS + 400,
			`backstop fired near ${WeightService.READ_TIMEOUT_MS}ms, got ${elapsed.toFixed(0)}ms`,
		);
	} finally {
		await service.disconnect();
	}
});

T("E. A single missed poll emits no cashier-facing scale:error", async (A) => {
	const { port, service } = await fxSetup({ weight: 1250 });
	let errors  = 0;
	let weights = 0;
	const onError  = () => { errors++; };
	const onWeight = () => { weights++; };

	window.addEventListener("scale:error",  onError);
	window.addEventListener("scale:weight", onWeight);

	try {
		port.dropNextAck();      // first poll of the loop misses its ACK
		service.startPolling();
		await fxDelay(900);      // missed poll + at least one retry
		service.stopPolling();

		A.equal(errors, 0, "no scale:error surfaced for a recoverable miss");
		A.ok(weights > 0, `polling continued and produced ${weights} reading(s)`);
	} finally {
		window.removeEventListener("scale:error",  onError);
		window.removeEventListener("scale:weight", onWeight);
		await service.disconnect();
	}
});

T("F. Connect → disconnect → connect still reads a weight", async (A) => {
	const { port, service } = await fxSetup({ weight: 2456 });
	try {
		const first = await service.getWeight();
		A.equal(first.value, 2.456, "reading before the reconnect");

		await service.disconnect();
		await service.connect();

		const second = await service.getWeight();
		A.equal(second.value, 2.456, "reading after the reconnect");
		A.ok(port.readable && port.writable, "streams are usable again");
	} finally {
		await service.disconnect();
	}
});

T("G. A parse error during polling still reaches the cashier", async (A) => {
	// Real ENQ/ACK/DC1/frame flow, but the parser rejects what arrives.
	const realParser = ParserRegistry.resolve(FX_CONFIG.scale_model);
	const failingParser = {
		constructor        : realParser.constructor,
		getFrameTerminator : () => realParser.getFrameTerminator(),
		requestFrame       : () => realParser.requestFrame(),
		parse              : () => {
			throw new ScaleError(ScaleErrorCode.PARSE_ERROR, "malformed frame");
		},
	};

	const { service } = await fxSetup({}, {}, failingParser);
	const seen = [];
	const onError = (e) => seen.push(e.detail.code);
	window.addEventListener("scale:error", onError);

	try {
		service.startPolling();
		const got = await fxWaitUntil(() => seen.length > 0, 3000);

		A.ok(got, "a scale:error was emitted for the parse failure");
		A.equal(seen[0], ScaleErrorCode.PARSE_ERROR, "it carries PARSE_ERROR");

		// Polling must not stop for a recoverable error.
		A.ok(service._pollTimer !== null, "polling continued after the parse error");
	} finally {
		service.stopPolling();
		window.removeEventListener("scale:error", onError);
		await service.disconnect();
	}
});

T("H. An unsettled platform during polling still reaches the cashier", async (A) => {
	// Status bit 5 clear → every reading is unstable → getWeight() gives up
	// after MAX_STABLE_POLLS and throws UNSTABLE_WEIGHT.
	const { service } = await fxSetup(
		{ status: 0x09 },                                 // bit 5 clear → unstable
		{ stable_weight_only: 1, read_interval: 1 },      // keep the 15 retries quick
	);
	const seen = [];
	const onError = (e) => seen.push(e.detail.code);
	window.addEventListener("scale:error", onError);

	try {
		service.startPolling();
		const got = await fxWaitUntil(() => seen.length > 0, 5000);

		A.ok(got, "a scale:error was emitted for the unsettled platform");
		A.equal(seen[0], ScaleErrorCode.UNSTABLE_WEIGHT, "it carries UNSTABLE_WEIGHT");
		A.ok(service._pollTimer !== null, "polling continued after the unstable error");
	} finally {
		service.stopPolling();
		window.removeEventListener("scale:error", onError);
		await service.disconnect();
	}
});

window.ScaleTestSuite = ScaleTestSuite;
