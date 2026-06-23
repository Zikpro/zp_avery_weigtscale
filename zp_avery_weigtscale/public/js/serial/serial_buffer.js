/**
 * SerialBuffer — accumulates raw bytes from the serial port until a complete
 * frame has arrived, then delivers the frame to a callback.
 *
 * Why this class exists:
 * Serial data arrives in arbitrary chunks. A single "W\r\n" response from the
 * scale may arrive as one chunk, two chunks, or ten chunks depending on OS
 * buffering, USB latency, and baud rate. Pasigono's decodeData() assumed each
 * read() call contained one complete message — causing the strWeight.concat()
 * bug where partial frames were silently lost.
 *
 * SerialBuffer solves this by:
 *   1. Appending every incoming chunk to an internal byte queue.
 *   2. Scanning the queue for the frame terminator (e.g. CR 0x0D).
 *   3. Emitting exactly one callback per complete frame.
 *   4. Keeping any leftover bytes for the next frame (streaming scales).
 *
 * It has NO knowledge of scale protocols or weight values — pure I/O plumbing.
 */
class SerialBuffer {

	/**
	 * @param {Uint8Array} terminator  — byte sequence that ends a frame (e.g. new Uint8Array([0x0D]))
	 * @param {number}     maxBytes    — safety cap; buffer flushed if exceeded (default 256)
	 */
	constructor(terminator, maxBytes = 256) {
		if (!(terminator instanceof Uint8Array) || terminator.length === 0) {
			throw new TypeError("SerialBuffer: terminator must be a non-empty Uint8Array");
		}
		this._terminator = terminator;
		this._maxBytes   = maxBytes;
		this._queue      = new Uint8Array(0);
		this._onFrame    = null;
	}

	/**
	 * Register the callback that receives complete frames.
	 * @param {function(Uint8Array): void} callback
	 */
	onFrame(callback) {
		this._onFrame = callback;
		return this;
	}

	/**
	 * Feed a raw chunk from the serial port into the buffer.
	 * Emits onFrame for every complete frame found in the accumulated data.
	 * @param {Uint8Array} chunk
	 */
	push(chunk) {
		if (!(chunk instanceof Uint8Array)) {
			throw new TypeError("SerialBuffer.push: chunk must be a Uint8Array");
		}

		// Safety cap — prevents unbounded growth if scale sends garbage
		if (this._queue.length + chunk.length > this._maxBytes) {
			console.warn("SerialBuffer: max bytes exceeded, flushing buffer");
			this._queue = new Uint8Array(0);
		}

		this._queue = SerialBuffer._concat(this._queue, chunk);
		this._scan();
	}

	/** Remove all buffered bytes without emitting. */
	flush() {
		this._queue = new Uint8Array(0);
	}

	// -------------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------------

	/** Scan queue for complete frames and emit each one. */
	_scan() {
		if (!this._onFrame) return;

		let searchFrom = 0;

		while (true) {
			const idx = this._findTerminator(searchFrom);
			if (idx === -1) break;

			const frameEnd  = idx + this._terminator.length;
			const frame     = this._queue.slice(0, frameEnd);

			this._onFrame(frame);

			this._queue = this._queue.slice(frameEnd);
			searchFrom  = 0;
		}
	}

	/**
	 * Returns the index of the first byte of the terminator in the queue,
	 * starting at `fromIndex`. Returns -1 if not found.
	 */
	_findTerminator(fromIndex = 0) {
		const q = this._queue;
		const t = this._terminator;

		outer:
		for (let i = fromIndex; i <= q.length - t.length; i++) {
			for (let j = 0; j < t.length; j++) {
				if (q[i + j] !== t[j]) continue outer;
			}
			return i;
		}
		return -1;
	}

	/** Concatenate two Uint8Arrays without mutating either. */
	static _concat(a, b) {
		const out = new Uint8Array(a.length + b.length);
		out.set(a, 0);
		out.set(b, a.length);
		return out;
	}
}

window.SerialBuffer = SerialBuffer;
