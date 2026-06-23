class SerialManager {

    constructor(settings = {}) {

        this.settings = settings;

        this.port = null;
        this.reader = null;
        this.writer = null;
        this.encoder = null;
    }

    async requestPort() {

        if (!("serial" in navigator)) {
            throw new Error("Web Serial API is not supported.");
        }

        this.port = await navigator.serial.requestPort();

        return this.port;
    }

    async getPorts() {

        return await navigator.serial.getPorts();

    }

    // NEW
    async connect() {

        if (!("serial" in navigator)) {
            throw new Error("Web Serial API is not supported.");
        }

        let ports = await navigator.serial.getPorts();

        if (!ports.length) {

            await navigator.serial.requestPort();

            ports = await navigator.serial.getPorts();

        }

        this.port = ports[0];

        this.encoder = new TextEncoderStream();

        await this.port.open({

            baudRate: this.settings.baud_rate,
            dataBits: this.settings.data_bits,
            stopBits: this.settings.stop_bits,
            parity: this.settings.parity.toLowerCase()

        });

        this.encoder.readable.pipeTo(this.port.writable).catch(error => {
            console.error("Pipe error:", error);
        });
        this.reader = this.port.readable.getReader();

        console.log("Scale connected.");

    }

    async send(command) {

        if (!this.encoder) {
            throw new Error("Scale is not connected.");
        }

        const writer = this.encoder.writable.getWriter();

        await writer.write(command);

        writer.releaseLock();

        console.log("Command sent:", command);

    }

    // NEW
    async read() {

        if (!this.reader) {
            throw new Error("Reader is not initialized.");
        }

        const { value, done } = await this.reader.read();

        if (done) {
            console.log("Reader closed.");
            return null;
        }

        console.log("Raw Data:", value);

        return value;

    }

    // MODIFY THIS
    // async getWeight() {

    //     console.log("Reading from physical scale...");
    //     await this.connect();

    //     return "Connected";

    // }
    async getWeight() {

        await this.connect();

        await this.send(this.settings.command);

        const rawData = await this.read();

        console.log("Received:", rawData);

        return rawData;

    }

}

window.SerialManager = SerialManager;