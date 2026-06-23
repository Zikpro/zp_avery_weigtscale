class WeightParser {

    toString(rawData) {

        if (!rawData) {
            return "";
        }

        let result = "";

        for (const byte of rawData) {

            // Ignore STX
            if (byte === 2) {
                continue;
            }

            // Stop at CR
            if (byte === 13) {
                break;
            }

            result += String.fromCharCode(byte);

        }

        return result.trim();

    }

    toFloat(weightString) {

        return parseFloat(weightString);

    }

    parse(rawData) {

        const text = this.toString(rawData);

        return this.toFloat(text);

    }

}

window.WeightParser = WeightParser;