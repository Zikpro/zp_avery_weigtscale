class SerialManager {

    constructor(settings = {}) {

        this.settings = settings;

        this.port = null;

        this.reader = null;
        this.writer = null;

        this._readLoopRunning = false;

        this._dataHandlers = [];
        this._disconnectHandlers = [];
    }


    // =========================================================================
    // Port selection
    // =========================================================================

    async requestPort() {

        if (!("serial" in navigator)) {
            throw new Error("Web Serial API is not supported.");
        }

        this.port = await navigator.serial.requestPort();

        return this.port;
    }


    async getPorts() {

        if (!("serial" in navigator)) {
            throw new Error("Web Serial API is not supported.");
        }

        return await navigator.serial.getPorts();
    }


    // =========================================================================
    // Connect
    // =========================================================================

    async connect(settings = {}) {

        if (!("serial" in navigator)) {
            throw new Error("Web Serial API is not supported.");
        }

        // Use supplied settings from WeightService.
        this.settings = settings || this.settings || {};

        console.log(
            "[Scale CONNECT] connect() called"
        );

        let ports = await navigator.serial.getPorts();

        console.log(
            `[Scale CONNECT] getPorts() returned ${ports.length} remembered port(s)`
        );

        if (!ports.length) {

            console.log(
                "[Scale CONNECT] No remembered port — requesting port"
            );

            this.port = await navigator.serial.requestPort();

        } else {

            this.port = ports[0];
        }

        console.log(
            "[Scale CONNECT] port selected — " +
            `readable.locked=${this.port.readable?.locked} ` +
            `writable.locked=${this.port.writable?.locked}`
        );


        const options = {

            baudRate: Number(this.settings.baud_rate) || 2400,

            dataBits: Number(this.settings.data_bits) || 7,

            stopBits: Number(this.settings.stop_bits) || 1,

            parity: String(
                this.settings.parity || "none"
            ).toLowerCase()

        };


        console.log(
            "[Scale CONNECT] port.open() with",
            options
        );


        // Open only if the port is not already open.
        if (!this.port.readable && !this.port.writable) {

            await this.port.open(options);

        } else {

            console.log(
                "[Scale CONNECT] port already appears open"
            );

        }


        console.log(
            "[Scale CONNECT] port.open() SUCCESS"
        );


        // ---------------------------------------------------------------------
        // Writer
        // ---------------------------------------------------------------------

        this.writer = this.port.writable.getWriter();


        // ---------------------------------------------------------------------
        // Reader
        // ---------------------------------------------------------------------

        this.reader = this.port.readable.getReader();

        this._readLoopRunning = true;

        this._startReadLoop();
    }


    // =========================================================================
    // Read loop
    // =========================================================================

    async _startReadLoop() {

        console.log("[Scale READ LOOP] started");

        try {

            while (this._readLoopRunning && this.reader) {

                const { value, done } = await this.reader.read();

                if (done) {

                    console.log(
                        "[Scale READ LOOP] reader closed"
                    );

                    break;
                }

                if (!value || value.length === 0) {
                    continue;
                }


                const hex = Array.from(value)
                    .map(b =>
                        b.toString(16)
                            .padStart(2, "0")
                            .toUpperCase()
                    )
                    .join(" ");


                console.log(
                    `[Scale RECV] ${value.length}B: [${hex}]`
                );


                // Send received data to WeightService.
                for (const handler of this._dataHandlers) {

                    try {

                        handler(value);

                    } catch (err) {

                        console.error(
                            "[Scale READ LOOP] data handler error:",
                            err
                        );

                    }
                }
            }

        } catch (err) {

            if (this._readLoopRunning) {

                console.error(
                    "[Scale READ LOOP] ERROR:",
                    err
                );

                for (const handler of this._disconnectHandlers) {

                    try {
                        handler(err);
                    } catch {}
                }
            }

        } finally {

            console.log(
                "[Scale READ LOOP] stopped"
            );
        }
    }


    // =========================================================================
    // Write
    // =========================================================================

    async write(data) {

        if (!this.writer) {

            throw new Error(
                "Scale is not connected."
            );
        }


        // Convert common input types to Uint8Array.
        let bytes;


        if (data instanceof Uint8Array) {

            bytes = data;

        } else if (data instanceof ArrayBuffer) {

            bytes = new Uint8Array(data);

        } else if (Array.isArray(data)) {

            bytes = new Uint8Array(data);

        } else if (typeof data === "string") {

            bytes = new TextEncoder().encode(data);

        } else {

            throw new Error(
                "Unsupported serial write data type."
            );
        }


        const hex = Array.from(bytes)
            .map(b =>
                b.toString(16)
                    .padStart(2, "0")
                    .toUpperCase()
            )
            .join(" ");


        console.log(
            `[Scale WRITE] ${bytes.length}B: [${hex}]`
        );


        await this.writer.write(bytes);


        console.log(
            "[Scale WRITE] sent"
        );
    }


    // =========================================================================
    // Data callbacks
    // =========================================================================

    onData(handler) {

        if (typeof handler !== "function") {
            return;
        }

        this._dataHandlers.push(handler);
    }


    // =========================================================================
    // Disconnect callbacks
    // =========================================================================

    onDisconnect(handler) {

        if (typeof handler !== "function") {
            return;
        }

        this._disconnectHandlers.push(handler);
    }


    // =========================================================================
    // Disconnect
    // =========================================================================

    async disconnect() {

        console.log(
            "[Scale DISCONNECT] disconnect() called"
        );


        this._readLoopRunning = false;


        // Release reader.
        if (this.reader) {

            try {

                await this.reader.cancel();

            } catch {}

            try {

                this.reader.releaseLock();

            } catch {}

            this.reader = null;
        }


        // Release writer.
        if (this.writer) {

            try {

                this.writer.releaseLock();

            } catch {}

            this.writer = null;
        }


        // Close port.
        if (this.port) {

            try {

                await this.port.close();

            } catch (err) {

                console.warn(
                    "[Scale DISCONNECT] port.close() error:",
                    err
                );
            }
        }


        this.port = null;


        console.log(
            "[Scale DISCONNECT] complete"
        );
    }
}


window.SerialManager = SerialManager;