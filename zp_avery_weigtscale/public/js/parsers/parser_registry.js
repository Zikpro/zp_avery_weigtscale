/**
 * ParserRegistry — maps a protocol ID string to its parser class.
 *
 * Why a registry:
 * WeightService needs to select the right parser based on the "Protocol"
 * field in Scale Settings. Without a registry, WeightService would contain
 * a giant if/else chain and would need editing every time a new scale is added —
 * violating the Open/Closed principle.
 *
 * With the registry, adding a new scale means:
 *   1. Write a new parser file.
 *   2. Call ParserRegistry.register(MyNewParser).
 *   3. Zero changes to WeightService or any existing code.
 *
 * The registry also supports auto-detection: if the user sets Protocol to
 * "auto", WeightService can iterate registered parsers and call canParse().
 *
 * Usage:
 *   const parser = ParserRegistry.resolve("avery_berkel_fx120");
 *   // Returns an AveryBerkelFX120Parser instance.
 *
 *   const parser = ParserRegistry.resolve("Avery Berkel FX120");
 *   // Same result — resolve() normalises display names → IDs.
 */
class ParserRegistry {

	static _registry = new Map();

	/**
	 * Register a parser class.
	 * @param {typeof IWeightParser} ParserClass  — must have static protocolId and protocolName
	 */
	static register(ParserClass) {
		if (typeof ParserClass.protocolId !== "string") {
			throw new TypeError(`ParserRegistry.register: ${ParserClass.name} is missing static protocolId`);
		}
		ParserRegistry._registry.set(ParserClass.protocolId, ParserClass);
	}

	/**
	 * Resolve a parser instance for the given protocol identifier.
	 *
	 * Accepts:
	 *   - protocolId  (snake_case key)             e.g. "avery_berkel_fx120"
	 *   - protocolName (display name, case-insensitive) e.g. "Avery Berkel FX120 (MT-8217)"
	 *   - partial match against protocolName        e.g. "Avery Berkel"
	 *
	 * Falls back to GenericRS232Parser when no match is found, so the scale
	 * at least attempts to read rather than crashing on an unknown model.
	 *
	 * @param  {string} protocolIdentifier
	 * @returns {IWeightParser}
	 */
	static resolve(protocolIdentifier) {
		if (!protocolIdentifier) {
			console.warn("ParserRegistry: no protocol specified, falling back to GenericRS232Parser");
			return new GenericRS232Parser();
		}

		const id = String(protocolIdentifier).trim();

		// 1. Exact match on protocolId (fastest path)
		if (ParserRegistry._registry.has(id)) {
			return new (ParserRegistry._registry.get(id))();
		}

		// 2. Case-insensitive match on protocolId or protocolName
		const lower = id.toLowerCase();
		for (const [, ParserClass] of ParserRegistry._registry) {
			if (
				ParserClass.protocolId.toLowerCase()   === lower ||
				ParserClass.protocolName.toLowerCase() === lower
			) {
				return new ParserClass();
			}
		}

		// 3. Partial match on protocolName (e.g. "Avery Berkel" matches "Avery Berkel FX120")
		for (const [, ParserClass] of ParserRegistry._registry) {
			if (ParserClass.protocolName.toLowerCase().includes(lower)) {
				return new ParserClass();
			}
		}

		// 4. Fallback
		console.warn(
			`ParserRegistry: no parser found for "${id}", ` +
			`falling back to GenericRS232Parser. ` +
			`Registered protocols: ${ParserRegistry.list().join(", ")}`
		);
		return new GenericRS232Parser();
	}

	/**
	 * Return all registered protocol IDs.
	 * @returns {string[]}
	 */
	static list() {
		return [...ParserRegistry._registry.keys()];
	}

	/**
	 * Return all registered parsers as display-friendly objects.
	 * Used to populate the "Protocol" select field in Scale Settings.
	 * @returns {{ id: string, name: string }[]}
	 */
	static listDetails() {
		return [...ParserRegistry._registry.values()].map(P => ({
			id   : P.protocolId,
			name : P.protocolName,
		}));
	}
}

// ── Self-registration ─────────────────────────────────────────────────────────
// Each parser registers itself when its file loads. The order here mirrors
// the specificity order used by resolve() — most specific first.
ParserRegistry.register(AveryBerkelFX120Parser);
ParserRegistry.register(MettlerToledo8217Parser);
ParserRegistry.register(GenericRS232Parser);

window.ParserRegistry = ParserRegistry;
