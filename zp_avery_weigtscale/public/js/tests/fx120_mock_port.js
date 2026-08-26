/**
 * FakeFX120Port — a software-only stand-in for a real Web Serial SerialPort,
 * implementing the ENQ/ACK/DC1/frame protocol our AveryBerkelFX120Parser
 * expects. Used ONLY by fx120_mock_harness.html (a local diagnostic page).
 *
 * NOT production code. Not referenced by hooks.py. Not loaded by POS Next.
 *
 * Design goal: sit exactly at the boundary SerialManager already talks to
 * (navigator.serial.getPorts()/requestPort(), port.open()/close(),
 * port.readable/port.writable) so that SerialManager, WeightService,
 * SerialBuffer, and AveryBerkelFX120Parser all run completely unmodified
 * against this mock — only the physical hardware is faked.
 *
 * readable/writable are REAL ReadableStream/WritableStream instances (not
 * plain objects), so .locked, getReader()/getWriter() lock enforcement, and
 * cancel()/releaseLock() all behave exactly per spec — the same as a real
 * SerialPort. This matters specifically for testing the writer-lock change
 * in serial_manager.js.
 */
class FakeFX120Port {

	/**
	 * @param {object} opts
	 * @param {number}  opts.weight        Simulated weight in whole grams (e.g. 244 -> 0.244 kg).
	 * @param {number}  opts.status        Status byte sent in every frame (0x29 = stable, per real hardware logs).
	 * @param {number}  opts.ackDelayMs    Delay before sending ACK after ENQ.
	 * @param {number}  opts.frameDelayMs  Delay before sending the frame after DC1.
	 * @param {number}  opts.minGapMs      If >0, enforce a minimum gap since the last completed
	 *                                     frame before ACKing a new ENQ — reproduces the ~2200ms
	 *                                     cadence behaviour reported from the real FX120. 0 = disabled
	 *                                     (always ACK immediately — a "perfectly behaved" scale).
	 * @param {string}  opts.notReadyReply "silence" | "nak" — what happens when a new ENQ arrives
	 *                                     before minGapMs has elapsed. Default "silence".
	 * @param {function(string):void} opts.log  Called with a formatted log line for every event.
	 */
	constructor(opts = {}) {
		this.weight        = opts.weight        ?? 244;
		this.status        = opts.status        ?? 0x29;
		this.ackDelayMs    = opts.ackDelayMs    ?? 15;
		this.frameDelayMs  = opts.frameDelayMs  ?? 45;
		this.minGapMs      = opts.minGapMs      ?? 0;
		this.notReadyReply = opts.notReadyReply ?? "silence";
		this._log          = opts.log || (() => {});

		this._awaitingDC1     = false;
		this._lastFrameSentAt = -Infinity;
		this._openOptions     = null;
		this._controller      = null;
		this._createStreams();

		
	}

	_createStreams() {
		this._controller = null;

		this.readable = new ReadableStream({
			start: (controller) => {
				this._controller = controller;
			},
		});

		this.writable = new WritableStream({
			write: (chunk) => this._onWrite(chunk),
		});
	}
	async open(options) {
		// A real SerialPort gets fresh streams when it is opened again.
		// Recreate them if the previous connection closed them.
		if (
			!this.readable ||
			this.readable.locked ||
			!this.writable ||
			this.writable.locked
		) {
			this._createStreams();
		}

		this._openOptions = options;

		this._logLine(
			`[MOCK] port.open() called with ${JSON.stringify(options)}`
		);
	}

	async close() {
		this._logLine(`[MOCK] port.close() called`);

		try {
			if (this._controller) {
				this._controller.close();
			}
		} catch {}

		this._controller = null;
	}

	/** Change the simulated weight/status live (e.g. from the harness UI). */
	setReading(weight, status = this.status) {
		this.weight = weight;
		this.status = status;
	}

	// -------------------------------------------------------------------------
	// Private — protocol state machine
	// -------------------------------------------------------------------------

	_onWrite(chunk) {
		const bytes = Array.from(chunk);
		this._logLine(`[MOCK WRITE] POS -> Scale: [${FakeFX120Port._hex(bytes)}]`);

		if (bytes.includes(0x05)) {
			this._handleEnq();
		} else if (bytes.includes(0x11)) {
			this._handleDc1();
		}
	}

	_handleEnq() {
		const sinceLastFrame = performance.now() - this._lastFrameSentAt;

		if (this.minGapMs > 0 && sinceLastFrame < this.minGapMs) {
			this._awaitingDC1 = false;
			if (this.notReadyReply === "nak") {
				this._logLine(`[MOCK] ENQ too soon (${sinceLastFrame.toFixed(0)}ms since last frame, need ${this.minGapMs}ms) — replying NAK`);
				setTimeout(() => this._emit([0x15]), this.ackDelayMs);
			} else {
				this._logLine(`[MOCK] ENQ too soon (${sinceLastFrame.toFixed(0)}ms since last frame, need ${this.minGapMs}ms) — staying silent`);
			}
			return;
		}

		this._awaitingDC1 = true;
		setTimeout(() => this._emit([0x06]), this.ackDelayMs);
	}

	_handleDc1() {
		if (!this._awaitingDC1) {
			this._logLine(`[MOCK] DC1 received without a prior ACK this cycle — replying NAK`);
			setTimeout(() => this._emit([0x15]), this.ackDelayMs);
			return;
		}
		this._awaitingDC1 = false;
		setTimeout(() => {
			this._lastFrameSentAt = performance.now();
			this._emit(this._buildFrame());
		}, this.frameDelayMs);
	}

	_buildFrame() {
		const digits = String(this.weight).padStart(5, "0").split("").map(c => c.charCodeAt(0));
		const bcc = [this.status, ...digits].reduce((a, b) => a ^ b, 0);
		return [0x02, this.status, ...digits, bcc, 0x03];
	}

	_emit(bytes) {
		this._logLine(`[MOCK RECV] Scale -> POS: [${FakeFX120Port._hex(bytes)}]`);
		this._controller.enqueue(new Uint8Array(bytes));
	}

	_logLine(msg) {
		this._log(`${performance.now().toFixed(1)}ms  ${msg}`);
	}

	static _hex(bytes) {
		return bytes.map(b => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
	}
}

/**
 * FakeSerial — stands in for `navigator.serial`. Extends EventTarget for
 * real addEventListener("disconnect", ...) support, matching SerialManager's
 * expectations, even though the mock never fires that event on its own.
 */
class FakeSerial extends EventTarget {
	constructor(port) {
		super();
		this._port = port;
	}
	async getPorts()    { return [this._port]; }
	async requestPort() { return this._port; }
}

/**
 * Installs the mock as navigator.serial. Call this BEFORE SerialManager.connect()
 * is invoked (it does not need to run before serial_manager.js/weight_service.js
 * are merely loaded/parsed — only before .connect() actually executes).
 */
function installFakeSerial(port) {
	Object.defineProperty(navigator, "serial", {
		configurable: true,
		value: new FakeSerial(port),
	});
}

window.FakeFX120Port  = FakeFX120Port;
window.FakeSerial     = FakeSerial;
window.installFakeSerial = installFakeSerial;
