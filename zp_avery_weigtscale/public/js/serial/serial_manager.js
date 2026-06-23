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

		if (this.isConnected) {
			throw new ScaleError(
				ScaleErrorCode.PORT_ALREADY_OPEN,
				"Serial port is already open. Call disconnect() first."
			);
		}

		const ports = await navigator.serial.getPorts();

		try {
			this._port = ports.length > 0 ? ports[0] : await navigator.serial.requestPort();
		} catch (err) {
			// User dismissed the port picker
			throw new ScaleError(ScaleErrorCode.PORT_NOT_SELECTED, "No port was selected.", err);
		}

		try {
			await this._port.open(SerialManager._buildOpenOptions(config));
		} catch (err) {
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
		this._readLoopActive = false;

		await this._releaseReader();
		await this._releaseWriter();

		if (this._port) {
			try {
				await this._port.close();
			} catch {
				// Port may already be closed after a disconnect event — ignore
			}
			this._port = null;
		}
	}

	/**
	 * Write a command string to the scale.
	 * @param {string} command  — e.g. "W" or "S" depending on protocol
	 */
	async write(command) {
		if (!this._writer) {
			throw new ScaleError(ScaleErrorCode.CONNECTION_FAILED, "Serial port is not open.");
		}

		try {
			await this._writer.write(command);
		} catch (err) {
			throw new ScaleError(ScaleErrorCode.WRITE_FAILED, err.message, err);
		}
	}

	// =========================================================================
	// Private — setup
	// =========================================================================

	_setupWriter() {
		this._encoder = new TextEncoderStream();
		// Pipe encoder output into the port's writable stream.
		// Errors here surface as CONNECTION_LOST via the read loop.
		this._encoder.readable.pipeTo(this._port.writable).catch(() => {});
		this._writer = this._encoder.writable.getWriter();
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
		if (this._reader) {
			try {
				this._reader.cancel();
				this._reader.releaseLock();
			} catch {
				// Already released — safe to ignore
			}
			this._reader = null;
		}
	}

	async _releaseWriter() {
		if (this._writer) {
			try {
				await this._writer.close();
				this._writer.releaseLock();
			} catch {
				// Already released or encoder closed — safe to ignore
			}
			this._writer  = null;
			this._encoder = null;
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
			baudRate : Number(config.baud_rate)  || 9600,
			dataBits : Number(config.data_bits)  || 7,
			stopBits : Number(config.stop_bits)  || 1,
			parity   : parityMap[config.parity]  || "even",
		};
	}
}

window.SerialManager = SerialManager;
