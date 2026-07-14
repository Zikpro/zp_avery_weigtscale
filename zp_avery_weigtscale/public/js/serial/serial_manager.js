/**
 * SerialManager — owns the serial port lifecycle and raw I/O.
 *
 * Single responsibility: open a port, write bytes, deliver byte chunks to a
 * registered callback. Nothing else. It does not know what a "weight" is.
 *
 * Design decisions vs Pasigono:
 * - Port is opened ONCE and kept open; reconnect() handles recovery.
 *   Pasigono opened fresh on every getWeight() — expensive and racy.
 * - reader.releaseLock() is always called in finally{} — Pasigono had it
 *   commented out, which permanently locked the port after the first read.
 * - No serial config is hardcoded. All params come from the caller.
 * - Emits onDisconnect so WeightService can react without polling.
 * - readLoop() streams into SerialBuffer — callers receive complete frames,
 *   not arbitrary chunks.
 */
class SerialManager {

	constructor() {
		this._port           = null;
		this._reader         = null;
		this._writer         = null;
		this._encoder        = null;
		this._readLoopActive = false;
		this._onDataCallback    = null;
		this._onDisconnectCallback = null;
	}

	// =========================================================================
	// Public API
	// =========================================================================

	/**
	 * True when a port is open and the read loop is running.
	 */
	get isConnected() {
		return this._readLoopActive && this._port !== null;
	}

	/**
	 * Register a callback to receive raw Uint8Array chunks as they arrive.
	 * Called by WeightService, which hands the chunk to SerialBuffer.
	 * @param {function(Uint8Array): void} callback
	 */
	onData(callback) {
		this._onDataCallback = callback;
		return this;
	}

	/**
	 * Register a callback invoked when the port unexpectedly disconnects.
	 * @param {function(ScaleError): void} callback
	 */
	onDisconnect(callback) {
		this._onDisconnectCallback = callback;
		return this;
	}

	/**
	 * Prompt the user to select a serial port and open it.
	 * Should only be called from a user gesture (button click) in Chrome/Edge.
	 *
	 * @param {object} config  — from Scale Settings doctype
	 * @param {number} config.baud_rate
	 * @param {number} config.data_bits
	 * @param {number} config.stop_bits
	 * @param {string} config.parity    — "None" | "Even" | "Odd"
	 */
	async connect(config) {
		SerialManager._assertWebSerialSupport();

		console.log(`[Scale CONNECT] connect() called — isConnected=${this.isConnected} hasPort=${!!this._port}`);

		if (this.isConnected) {
			console.warn("[Scale CONNECT] already connected — throwing PORT_ALREADY_OPEN");
			throw new ScaleError(
				ScaleErrorCode.PORT_ALREADY_OPEN,
				"Serial port is already open. Call disconnect() first."
			);
		}

		const ports = await navigator.serial.getPorts();
		console.log(`[Scale CONNECT] getPorts() returned ${ports.length} remembered port(s)`);

		try {
			this._port = ports.length > 0 ? ports[0] : await navigator.serial.requestPort();
			console.log(`[Scale CONNECT] port selected — readable.locked=${this._port.readable?.locked} writable.locked=${this._port.writable?.locked}`);
		} catch (err) {
			// User dismissed the port picker
			throw new ScaleError(ScaleErrorCode.PORT_NOT_SELECTED, "No port was selected.", err);
		}

		try {
			const opts = SerialManager._buildOpenOptions(config);
			console.log(`[Scale CONNECT] port.open() with`, opts);
			await this._port.open(opts);
			console.log(`[Scale CONNECT] port.open() SUCCESS`);
		} catch (err) {
			console.error(`[Scale CONNECT] port.open() FAILED:`, err.message);
			this._port = null;
			throw new ScaleError(ScaleErrorCode.CONNECTION_FAILED, err.message, err);
		}

		this._setupWriter();
		this._startReadLoop();

		// React when the user physically unplugs the cable
		navigator.serial.addEventListener("disconnect", (event) => {
			if (event.target === this._port) {
				this._handleUnexpectedDisconnect();
			}
		}, { once: true });
	}

	/**
	 * Gracefully close the port and release all locks.
	 * Safe to call even if the port is already closed.
	 */
	async disconnect() {
		console.log(`[Scale DISCONNECT] disconnect() called — hasPort=${!!this._port} hasReader=${!!this._reader} hasWriter=${!!this._writer}`);
		this._readLoopActive = false;

		await this._releaseReader();
		console.log(`[Scale DISCONNECT] reader released`);

		await this._releaseWriter();
		console.log(`[Scale DISCONNECT] writer released`);

		if (this._port) {
			const readableLocked = this._port.readable?.locked;
			const writableLocked = this._port.writable?.locked;
			console.log(`[Scale DISCONNECT] calling port.close() — readable.locked=${readableLocked} writable.locked=${writableLocked}`);
			try {
				await this._port.close();
				console.log(`[Scale DISCONNECT] port.close() SUCCESS`);
			} catch (err) {
				console.error(`[Scale DISCONNECT] port.close() FAILED:`, err.message);
				// Port may already be closed after a disconnect event — ignore
			}
			this._port = null;
		} else {
			console.log(`[Scale DISCONNECT] no port to close`);
		}
	}

	/**
	 * Write a command to the scale. Accepts a string (e.g. "W") or a Uint8Array
	 * of raw bytes (e.g. ENQ 0x05, DC1 0x11 for the ENQ/ACK/DC1 handshake).
	 *
	 * @param {string|Uint8Array|number[]} command
	 */
	async write(command) {
		if (!this._writer) {
			throw new ScaleError(ScaleErrorCode.CONNECTION_FAILED, "Serial port is not open.");
		}

		try {
			let bytes;
			if (command instanceof Uint8Array) {
				bytes = command;
			} else if (Array.isArray(command)) {
				bytes = new Uint8Array(command);
			} else {
				bytes = new TextEncoder().encode(String(command));
			}
			await this._writer.write(bytes);
		} catch (err) {
			throw new ScaleError(ScaleErrorCode.WRITE_FAILED, err.message, err);
		}
	}

	// =========================================================================
	// Private — setup
	// =========================================================================

	_setupWriter() {
		// Write directly to port.writable so both string commands and raw byte
		// arrays (e.g. ENQ 0x05, DC1 0x11 for the handshake) can be sent without
		// a TextEncoderStream in the middle.
		this._writer = this._port.writable.getWriter();
		this._encoder = null; // not used; kept as field so _releaseWriter is safe
	}

	_startReadLoop() {
		this._readLoopActive = true;
		this._reader = this._port.readable.getReader();
		this._runReadLoop();
	}

	/**
	 * The read loop. Runs until disconnect() sets _readLoopActive = false
	 * or the port closes. Always releases the reader lock on exit.
	 */
	async _runReadLoop() {
		try {
			while (this._readLoopActive) {
				const { value, done } = await this._reader.read();

				if (done) break;

				if (value instanceof Uint8Array && value.length > 0 && this._onDataCallback) {
					this._onDataCallback(value);
				}
			}
		} catch (err) {
			if (this._readLoopActive) {
				// Unexpected error — not a clean disconnect()
				this._handleUnexpectedDisconnect(err);
			}
		} finally {
			await this._releaseReader();
		}
	}

	// =========================================================================
	// Private — teardown helpers
	// =========================================================================

	async _releaseReader() {
		const reader = this._reader;
		if (!reader) return;
		// Null immediately so a concurrent call from _runReadLoop's finally is a no-op.
		this._reader = null;
		try {
			// MUST await cancel() — it resolves the pending reader.read() in the loop.
			// Without await, port.close() runs before the reader is done and Chrome keeps
			// the port locked, causing "Failed to open serial port" on the next connect.
			await reader.cancel();
		} catch {
			// Port may already be closed — safe to ignore
		}
		try {
			reader.releaseLock();
		} catch {
			// Already released — safe to ignore
		}
	}

	async _releaseWriter() {
		if (this._writer) {
			console.log(`[Scale DISCONNECT] calling writer.close()`);
			try {
				// Close the writer so port.close() can proceed cleanly.
				// (Web Serial requires both readable and writable to be closed first.)
				await this._writer.close();
				console.log(`[Scale DISCONNECT] writer.close() SUCCESS`);
			} catch (err) {
				console.error(`[Scale DISCONNECT] writer.close() FAILED:`, err.message, "— port may stay locked");
			}
			this._writer  = null;
			this._encoder = null;
		} else {
			console.log(`[Scale DISCONNECT] no writer to release`);
		}
	}

	_handleUnexpectedDisconnect(err = null) {
		this._readLoopActive = false;
		this._port           = null;
		this._reader         = null;
		this._writer         = null;
		this._encoder        = null;

		if (this._onDisconnectCallback) {
			const scaleError = new ScaleError(
				ScaleErrorCode.CONNECTION_LOST,
				err ? err.message : "Serial port disconnected unexpectedly.",
				err
			);
			this._onDisconnectCallback(scaleError);
		}
	}

	// =========================================================================
	// Private — static helpers
	// =========================================================================

	static _assertWebSerialSupport() {
		if (!("serial" in navigator)) {
			throw new ScaleError(
				ScaleErrorCode.SERIAL_NOT_SUPPORTED,
				"Web Serial API is not supported in this browser. Use Chrome or Edge."
			);
		}
	}

	/**
	 * Maps Scale Settings field values to the options object expected by port.open().
	 * Frappe stores parity as "None"/"Even"/"Odd"; Web Serial API expects "none"/"even"/"odd".
	 */
	static _buildOpenOptions(config) {
		const parityMap = { None: "none", Even: "even", Odd: "odd" };

		return {
			baudRate : Number(config.baud_rate)  || 2400,
			dataBits : Number(config.data_bits)  || 7,
			stopBits : Number(config.stop_bits)  || 1,
			parity   : parityMap[config.parity]  ?? "none",
		};
	}
}

window.SerialManager = SerialManager;
