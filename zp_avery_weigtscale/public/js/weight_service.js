/**
 * WeightService — the single public facade for all scale operations.
 *
 * Responsibilities:
 *   - Read Scale Settings from Frappe and validate them.
 *   - In debug_mode: delegate to ScaleSimulator.
 *   - In live mode: manage SerialManager + SerialBuffer + selected Parser.
 *   - Expose a simple async getWeight() → WeightReading API.
 *   - Emit DOM CustomEvents so POSNext (or any other consumer) can react
 *     without being directly coupled to this class.
 *   - Honour stable_weight_only: poll until a stable reading arrives.
 *
 * Event contract (dispatched on window):
 *   "scale:connected"    — { detail: { model, protocol } }
 *   "scale:disconnected" — { detail: { error: ScaleError | null } }
 *   "scale:weight"       — { detail: WeightReading }   (each poll result)
 *   "scale:error"        — { detail: ScaleError }
 *
 * Usage (Scale Settings form — connect button):
 *   const service = await WeightService.fromSettings();
 *   await service.connect();
 *   const reading = await service.getWeight();
 *   console.log(reading.toString()); // "1.234 kg"
 *   await service.disconnect();
 *
 * Usage (continuous polling):
 *   await service.connect();
 *   service.startPolling();   // emits "scale:weight" events
 *   // ...
 *   service.stopPolling();
 *   await service.disconnect();
 */
class WeightService {

	static READ_TIMEOUT_MS  = 3000;  // Give up waiting for a frame after 3s
	static MAX_STABLE_POLLS = 15;    // Max polls before giving up on stability
	static POLL_INTERVAL_MS = 500;   // Default interval for continuous polling

	// =========================================================================
	// Construction
	// =========================================================================

	/**
	 * @param {object}        config     — raw Scale Settings document fields
	 * @param {IWeightParser} parser     — resolved by ParserRegistry
	 * @param {boolean}       debugMode  — true → use ScaleSimulator
	 */
	constructor(config, parser, debugMode) {
		this._config    = config;
		this._parser    = parser;
		this._debugMode = Boolean(debugMode);
		this._serial    = debugMode ? null : new SerialManager();
		this._simulator = debugMode ? new ScaleSimulator(config) : null;
		this._buffer    = debugMode ? null : new SerialBuffer(parser.getFrameTerminator());
		this._pollTimer = null;
		this._connected = false;
		this._ackWaiter = null; // set during ENQ→DC1 phase to intercept the ACK byte

		if (!debugMode) {
			this._serial.onData(chunk => {
				const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
				console.log(`[Scale RECV] ${chunk.length}B: [${hex}]  ackWaiterActive=${!!this._ackWaiter}`);

				// During the ENQ→DC1 handshake phase, intercept the ACK (0x06) byte.
				// Any 0x06 arriving before DC1 is sent must be the scale's ACK response.
				if (this._ackWaiter && chunk instanceof Uint8Array) {
					const ackIdx = chunk.indexOf(0x06);
					if (ackIdx !== -1) {
						console.log(`[Scale ACK] 0x06 found at byte index ${ackIdx} — resolving _waitForAck`);
						// Pass any non-ACK bytes (before or after) to the buffer
						const rest = new Uint8Array([
							...chunk.slice(0, ackIdx),
							...chunk.slice(ackIdx + 1),
						]);
						if (rest.length > 0) this._buffer.push(rest);
						const resolve = this._ackWaiter;
						this._ackWaiter = null;
						resolve(); // unblock _waitForAck()
						return;
					} else {
						console.log(`[Scale ACK] chunk received but no 0x06 found — forwarding to buffer`);
					}
				}
				this._buffer.push(chunk);
			});
			this._serial.onDisconnect(err => {
				this._connected = false;
				this._emit("scale:disconnected", { error: err });
				this._emit("scale:error", err);
			});
		}
	}

	/**
	 * Factory — loads Scale Settings from Frappe and wires up the correct parser.
	 * Use this instead of `new WeightService(...)` in production code.
	 *
	 * @returns {Promise<WeightService>}
	 */
	static async fromSettings() {
		let doc;
		try {
			// Use plain fetch so this works on both the Frappe desk AND the
			// standalone POSNext page (which does not load the frappe JS library).
			const res = await fetch("/api/resource/Scale Settings/Scale Settings", {
				headers: { "Accept": "application/json" },
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = await res.json();
			doc = json.data;
		} catch (err) {
			throw new ScaleError(
				ScaleErrorCode.INVALID_CONFIG,
				"Could not load Scale Settings from Frappe.",
				err
			);
		}

		const config = doc;

		if (!config.enabled) {
			throw new ScaleError(
				ScaleErrorCode.INVALID_CONFIG,
				"Scale integration is disabled. Enable it in Scale Settings."
			);
		}

		const debugMode = Boolean(config.debug_mode);
		const parser    = ParserRegistry.resolve(config.protocol || config.scale_model);

		return new WeightService(config, parser, debugMode);
	}

	// =========================================================================
	// Connection lifecycle
	// =========================================================================

	get isConnected() {
		return this._debugMode ? true : this._connected;
	}

	/**
	 * Open the serial port (no-op in debug mode — simulator needs no port).
	 */
	async connect() {
		if (this._debugMode) {
			this._connected = true;
			this._emit("scale:connected", {
				model    : this._config.scale_model || "Simulator",
				protocol : "debug",
			});
			return;
		}

		await this._serial.connect(this._config);
		this._connected = true;

		this._emit("scale:connected", {
			model    : this._config.scale_model,
			protocol : this._parser.constructor.protocolName,
		});
	}

	/**
	 * Close the port and stop any active polling.
	 */
	async disconnect() {
		this.stopPolling();

		if (!this._debugMode && this._serial) {
			await this._serial.disconnect();
		}

		this._connected = false;
		this._emit("scale:disconnected", { error: null });
	}

	// =========================================================================
	// Weight reading
	// =========================================================================

	/**
	 * Get one weight reading. If stable_weight_only is set, polls until the
	 * scale reports a stable value or MAX_STABLE_POLLS is reached.
	 *
	 * @returns {Promise<WeightReading>}
	 * @throws  {ScaleError}
	 */
	async getWeight() {
		if (!this._debugMode && !this._connected) {
			throw new ScaleError(
				ScaleErrorCode.CONNECTION_FAILED,
				"Scale is not connected. Call connect() first."
			);
		}

		// Single poll function — same stable_weight_only logic for debug and live.
		const singlePoll = this._debugMode
			? () => this._simulator.getWeight()
			: () => this._pollOnce();

		const stableOnly = Boolean(this._config.stable_weight_only);

		if (!stableOnly) {
			return singlePoll();
		}

		// Poll until stable or give up
		for (let attempt = 0; attempt < WeightService.MAX_STABLE_POLLS; attempt++) {
			const reading = await singlePoll();

			if (reading.stable) {
				return reading;
			}

			this._emit("scale:weight", reading);

			await WeightService._delay(Number(this._config.read_interval) || WeightService.POLL_INTERVAL_MS);
		}

		throw new ScaleError(
			ScaleErrorCode.UNSTABLE_WEIGHT,
			`Scale did not stabilise after ${WeightService.MAX_STABLE_POLLS} polls. ` +
			"Check that the product is sitting still on the scale."
		);
	}

	// =========================================================================
	// Continuous polling (emits "scale:weight" events)
	// =========================================================================

	/**
	 * Start emitting "scale:weight" events on every successful poll.
	 * Errors are emitted as "scale:error" and polling continues.
	 *
	 * Uses recursive setTimeout instead of setInterval so the next poll
	 * only starts AFTER the current one completes. setInterval fires every
	 * N ms regardless of whether the previous async tick is still running,
	 * which causes concurrent polls — multiple ENQ/DC1 sequences in flight
	 * simultaneously — leading to READ_TIMEOUT errors on every cycle.
	 */
	startPolling() {
		if (this._pollTimer !== null) return;

		const interval = Number(this._config.read_interval) || WeightService.POLL_INTERVAL_MS;

		const tick = async () => {
			if (this._pollTimer === null) return; // stopPolling() was called

			try {
				const reading = await this.getWeight();
				this._emit("scale:weight", reading);
			} catch (err) {
				const scaleErr = err instanceof ScaleError
					? err
					: new ScaleError(ScaleErrorCode.READ_TIMEOUT, err.message, err);

				this._emit("scale:error", scaleErr);

				if (!scaleErr.isRecoverable()) {
					this.stopPolling();
					return;
				}
			}

			// Schedule the next poll only after this one is fully done.
			if (this._pollTimer !== null) {
				this._pollTimer = setTimeout(tick, interval);
			}
		};

		this._pollTimer = setTimeout(tick, 0); // start immediately
	}

	/** Stop the polling loop. */
	stopPolling() {
		if (this._pollTimer !== null) {
			clearTimeout(this._pollTimer);
			this._pollTimer = null;
		}
	}

	// =========================================================================
	// Private — reading implementation
	// =========================================================================

	/**
	 * Send the read command and wait for one complete frame from SerialBuffer.
	 * Resolves with a parsed WeightReading or rejects with a ScaleError.
	 */
	_pollOnce() {
		return new Promise(async (resolve, reject) => {
			// Discard any leftover bytes from a previous poll (e.g. a stale ACK byte
			// that arrived after the frame was already emitted).
			this._buffer.flush();

			let settled = false;

			const _pollT0 = performance.now();
			const _ms = () => (performance.now() - _pollT0).toFixed(1) + "ms";

			const timeout = setTimeout(() => {
				if (settled) return;
				settled = true;
				this._ackWaiter = null; // cancel any pending ACK wait
				this._buffer.flush();
				console.warn(`[Scale TIMEOUT] No frame after ${_ms()} — READ_TIMEOUT`);
				reject(new ScaleError(
					ScaleErrorCode.READ_TIMEOUT,
					`No response from scale within ${WeightService.READ_TIMEOUT_MS}ms. ` +
					"Check cable connection and baud rate settings."
				));
			}, WeightService.READ_TIMEOUT_MS);

			// Register a one-shot frame handler
			this._buffer.onFrame(frame => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				// Reset to avoid receiving the next poll's frame in this handler
				this._buffer.onFrame(null);

				const hex = Array.from(frame).map(b => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
				console.log(`[Scale FRAME] received at ${_ms()}: [${hex}]`);

				try {
					const reading = this._parser.parse(frame);
					console.log(`[Scale PARSE] OK → ${reading.toString()}`);
					resolve(reading);
				} catch (err) {
					console.error(`[Scale PARSE] ERROR:`, err.message);
					reject(err instanceof ScaleError ? err : new ScaleError(
						ScaleErrorCode.PARSE_ERROR, err.message, err
					));
				}
			});

			// Send the request AFTER setting up the handler to avoid race conditions.
			//
			// ENQ/ACK protocol (e.g. AveryBerkelFX120):
			//   phase1 (ENQ) → scale responds with ACK → phase2 (DC1) → scale sends frame.
			//   The ACK byte (0x06) is intercepted by onData before reaching SerialBuffer,
			//   which triggers _waitForAck() to resolve immediately so DC1 is sent on time.
			//
			// Streaming protocol (e.g. MettlerToledo, Generic):
			//   requestFrame() returns null → send the text command from settings (e.g. "W").
			try {
				const handshake = this._parser.requestFrame();
				if (handshake) {
					console.log(`[Scale ENQ] sending 0x05 at ${_ms()}`);
					await this._serial.write(handshake.phase1);             // ENQ
					await this._waitForAck(300);                            // wait for ACK byte (0x06) or 300ms timeout
					if (settled) {
						console.log(`[Scale DC1] SKIPPED — poll already timed out at ${_ms()}`);
						return;                                             // poll already timed out while waiting for ACK
					}
					console.log(`[Scale DC1] sending 0x11 at ${_ms()}`);
					await this._serial.write(handshake.phase2);             // DC1
					console.log(`[Scale DC1] sent — waiting for frame`);
				} else {
					const cmd = this._config.command;
					if (cmd) await this._serial.write(cmd);
				}
			} catch (err) {
				if (!settled) {
					settled = true;
					clearTimeout(timeout);
					this._buffer.onFrame(null);
					console.error(`[Scale WRITE ERROR]`, err.message);
					reject(err);
				}
			}
		});
	}

	// =========================================================================
	// Private — ACK detection
	// =========================================================================

	/**
	 * Wait for the ACK byte (0x06) to arrive from the scale, up to `timeoutMs`.
	 * Resolves when ACK is detected by the onData interceptor (this._ackWaiter).
	 * If ACK never arrives within the timeout, resolves anyway so DC1 is still sent.
	 */
	_waitForAck(timeoutMs = 300) {
		return new Promise((resolve) => {
			const t0 = performance.now();
			console.log(`[Scale ACK WAIT] started — will timeout after ${timeoutMs}ms`);

			const timer = setTimeout(() => {
				// ACK didn't arrive in time — clear the waiter and send DC1 anyway.
				// This handles scales that skip ACK or adapters with extreme latency.
				const elapsed = (performance.now() - t0).toFixed(1);
				console.warn(`[Scale ACK WAIT] TIMED OUT after ${elapsed}ms — no 0x06 received, sending DC1 anyway`);
				this._ackWaiter = null;
				resolve();
			}, timeoutMs);

			this._ackWaiter = () => {
				clearTimeout(timer);
				const elapsed = (performance.now() - t0).toFixed(1);
				console.log(`[Scale ACK WAIT] ACK received after ${elapsed}ms — proceeding to DC1`);
				resolve();
			};
		});
	}

	// =========================================================================
	// Private — event helpers
	// =========================================================================

	_emit(eventName, detail) {
		window.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: false }));
	}

	static _delay(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

window.WeightService = WeightService;
