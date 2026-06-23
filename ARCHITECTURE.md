# Zp Avery Weigtscale — Complete Architecture & File Reference

**App:** `zp_avery_weigtscale`  
**Framework:** Frappe v16 / ERPNext v16 / POSNext (BrainWise)  
**Hardware:** Avery Berkel FX120 via RS232 (USB-to-RS232 adapter)  
**Protocol:** Mettler Toledo MT-8217 (FX120 compatibility mode)  
**Communication:** Web Serial API (Chrome / Edge only)  

---

## Table of Contents

1. [Business Requirement](#1-business-requirement)
2. [Architecture Overview](#2-architecture-overview)
3. [Dependency Graph](#3-dependency-graph)
4. [File Reference — Every File Explained](#4-file-reference)
   - [Core Contracts](#41-core-contracts)
   - [Serial Layer](#42-serial-layer)
   - [Parser Layer](#43-parser-layer)
   - [Simulator](#44-simulator)
   - [Orchestrator](#45-orchestrator)
   - [POSNext Integration](#46-posnext-integration)
   - [Tests](#47-tests)
   - [Frappe DocType](#48-frappe-doctype)
   - [App Configuration](#49-app-configuration)
5. [Data Flow — Step by Step](#5-data-flow)
6. [Design Patterns Used](#6-design-patterns-used)
7. [Error Taxonomy](#7-error-taxonomy)
8. [How to Add a New Scale](#8-how-to-add-a-new-scale)
9. [How to Run the Tests](#9-how-to-run-the-tests)
10. [Deployment](#10-deployment)
11. [What Was Wrong With the Reference (Pasigono)](#11-what-was-wrong-with-the-reference)

---

## 1. Business Requirement

Client workflow at the point of sale:

```
Staff places product on scale
        ↓
Staff selects item in POSNext
        ↓
POSNext reads weight from scale automatically
        ↓
Quantity field is filled with the weight value
        ↓
Price = Weight × Price per Kg
        ↓
Item added to cart
```

Exactly like a supermarket POS system.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   Scale Settings                        │
│              (Frappe Single DocType)                    │
│  enabled, debug_mode, scale_model, protocol,            │
│  baud_rate, data_bits, stop_bits, parity,               │
│  command, read_interval, stable_weight_only             │
└───────────────────────┬─────────────────────────────────┘
                        │  frappe.client.get
                        ▼
┌─────────────────────────────────────────────────────────┐
│              WeightService.fromSettings()               │
│                    (Orchestrator)                       │
│                                                         │
│   debug_mode = true          debug_mode = false         │
│         │                          │                    │
│         ▼                          ▼                    │
│  ScaleSimulator           SerialManager                 │
│  (software only)          (port I/O only)               │
│                                   │ raw Uint8Array      │
│                                   ▼                     │
│                            SerialBuffer                 │
│                         (frame accumulator)             │
│                                   │ complete frame      │
│                                   ▼                     │
│                       ParserRegistry.resolve()          │
│                                   │                     │
│              ┌────────────────────┼──────────────────┐  │
│              ▼                    ▼                   ▼  │
│   AveryBerkelFX120     MettlerToledo8217      GenericRS232│
│      Parser                Parser               Parser   │
│              └────────────────────┴──────────────────┘  │
│                                   │                     │
│                                   ▼                     │
│                           WeightReading                 │
│                        (immutable value object)         │
└───────────────────────┬─────────────────────────────────┘
                        │  window CustomEvents
                        │  scale:weight
                        │  scale:connected
                        │  scale:disconnected
                        │  scale:error
                        ▼
┌─────────────────────────────────────────────────────────┐
│                  POSScaleWidget                         │
│              (floating UI overlay)                      │
│                                                         │
│   [●] Weighing Scale          1.234 kg                  │
│   [Connect]              [Apply Weight]                 │
└───────────────────────┬─────────────────────────────────┘
                        │  native InputEvent on qty input
                        ▼
┌─────────────────────────────────────────────────────────┐
│                     POSNext                             │
│              (BrainWise Vue SPA)                        │
│         Quantity field updated → cart recalculates      │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Dependency Graph

Files must be loaded in this exact order (enforced by `hooks.py`):

```
scale_error.js              ← no dependencies
weight_reading.js           ← no dependencies
i_weight_parser.js          ← WeightReading, ScaleError
serial_buffer.js            ← ScaleError
serial_manager.js           ← SerialBuffer, ScaleError
avery_berkel_fx120_parser.js ← IWeightParser, WeightReading, ScaleError
mettler_toledo_8217_parser.js ← IWeightParser, WeightReading, ScaleError
generic_rs232_parser.js     ← IWeightParser, WeightReading, ScaleError
parser_registry.js          ← all three parsers above, ScaleError
scale_simulator.js          ← WeightReading
weight_service.js           ← SerialManager, SerialBuffer, ParserRegistry,
                               ScaleSimulator, WeightReading, ScaleError
pos_scale_widget.js         ← WeightService (via CustomEvents)
```

---

## 4. File Reference

### 4.1 Core Contracts

---

#### `public/js/core/scale_error.js`

**Purpose:** Typed error taxonomy. Every failure mode in the system has a unique string code so callers can branch programmatically — not by matching error message strings.

**Classes exported to `window`:**
- `ScaleErrorCode` — frozen object of all error code constants
- `ScaleError extends Error` — carries `.code`, `.cause`, and `.isRecoverable()`

**Error codes defined:**

| Code | When it is thrown |
|---|---|
| `SERIAL_NOT_SUPPORTED` | Browser is not Chrome/Edge — Web Serial API unavailable |
| `PORT_NOT_SELECTED` | User dismissed the browser port picker dialog |
| `PORT_ACCESS_DENIED` | OS denied permission to the serial port |
| `PORT_ALREADY_OPEN` | `connect()` called when port is already open |
| `CONNECTION_FAILED` | `port.open()` threw — wrong baud rate, port in use |
| `CONNECTION_LOST` | Cable unplugged while reading |
| `WRITE_FAILED` | Could not send command to scale |
| `READ_TIMEOUT` | Scale did not respond within 3 seconds |
| `PARSE_ERROR` | Bytes received but could not be decoded as a weight |
| `UNSTABLE_WEIGHT` | Scale flagged reading unstable and stable_weight_only is on |
| `NO_PARSER_FOUND` | No parser registered for the configured protocol |
| `INVALID_CONFIG` | Scale Settings document missing or disabled |

**`isRecoverable()`:** Returns `true` for `READ_TIMEOUT`, `PARSE_ERROR`, `UNSTABLE_WEIGHT` — errors the system can retry automatically. Returns `false` for hardware/permission errors that require human intervention.

**Why it was needed:** The reference project (Pasigono) had `catch(error) { //TODO }` in every catch block, silently swallowing all errors. This made debugging in production impossible.

---

#### `public/js/core/weight_reading.js`

**Purpose:** Immutable value object representing one scale measurement.

**Class exported:** `WeightReading`

**Fields:**

| Field | Type | Description |
|---|---|---|
| `value` | `number` | Weight in the configured unit, e.g. `1.234` |
| `unit` | `string` | `"kg"`, `"lb"`, `"g"`, `"oz"` |
| `stable` | `boolean` | `true` = scale confirmed stable reading |
| `raw` | `string` | Original string from the scale, e.g. `" +00001.234 kg"` |
| `timestamp` | `Date` | When this reading was taken |

**Key methods:**
- `isValid()` — `true` when `value > 0` AND `stable === true`
- `toString()` — `"1.234 kg"` (stable) or `"~1.234 kg"` (unstable)
- `toObject()` — plain JSON-safe object for passing to Frappe/Vue
- `WeightReading.zero(unit)` — factory for a zero/tare reading
- `WeightReading.simulated(value, unit)` — factory for debug readings

**Why immutable:** A reading is a historical fact. Once the scale returns "1.234 kg at 14:23:01", that cannot change. Allowing mutation would let bugs silently corrupt readings as they pass between layers. `Object.freeze(this)` enforces this.

**Why it was needed:** Without a value object, raw floats were passed everywhere. You couldn't tell if `1.234` was stable or unstable, what unit it was in, or when it was measured.

---

#### `public/js/core/i_weight_parser.js`

**Purpose:** Abstract base class that defines the contract every scale parser must implement.

**Class exported:** `IWeightParser`

**Methods every subclass must implement:**

| Method | Returns | Description |
|---|---|---|
| `static get protocolId()` | `string` | Snake_case registry key, e.g. `"avery_berkel_fx120"` |
| `static get protocolName()` | `string` | Human-readable name for logs/UI |
| `getFrameTerminator()` | `Uint8Array` | Byte sequence that ends a complete frame |
| `canParse(rawData)` | `boolean` | Quick sanity check before parse() |
| `parse(rawData)` | `WeightReading` | Decode raw bytes into a reading |

**Why a base class instead of a plain interface comment:** JavaScript has no compile-time interfaces. Base class methods throw `Error("must implement X")` at runtime, giving a clear diagnostic instead of `"undefined is not a function"` somewhere deep in WeightService.

**Why `getFrameTerminator()`:** SerialBuffer needs to know when a frame is complete. Instead of hardcoding CR everywhere, each parser declares its own terminator. A future streaming scale could return `new Uint8Array([0x0D, 0x0A])` for CRLF without changing anything else.

---

### 4.2 Serial Layer

---

#### `public/js/serial/serial_buffer.js`

**Purpose:** Accumulates raw bytes from the serial port until a complete frame has arrived, then delivers the frame to a callback.

**Class exported:** `SerialBuffer`

**Constructor:** `new SerialBuffer(terminator: Uint8Array, maxBytes = 256)`

**Key methods:**
- `onFrame(callback)` — register the handler that receives complete frames
- `push(chunk: Uint8Array)` — feed a raw chunk from the serial port
- `flush()` — discard all buffered bytes (used on timeout)

**Why it was needed — the Pasigono bug:**

Pasigono assumed each `reader.read()` call returned one complete message:
```javascript
// Pasigono — BROKEN
var [response, completed] = await decodeData(value);
if (!completed) {
    strWeight.concat(response);  // BUG: .concat() doesn't mutate in JS!
```
Two bugs in one line:
1. `.concat()` returns a new string; the result is thrown away. Partial frames are silently lost.
2. If the scale sends a frame split across two read() calls, the first half vanishes.

SerialBuffer fixes this by accumulating bytes correctly and only emitting when the terminator is detected.

**Algorithm:**
1. Append incoming chunk to internal queue (`Uint8Array`)
2. Scan queue for terminator byte sequence
3. If found: slice out the complete frame, emit it, keep remaining bytes
4. Repeat scan (handles two frames arriving in one chunk)
5. If not found: wait for next `push()`

**Safety cap:** If buffer exceeds `maxBytes` without a terminator (garbled data / wrong baud rate), it flushes to prevent unbounded memory growth.

---

#### `public/js/serial/serial_manager.js`

**Purpose:** Own the serial port lifecycle and raw I/O. Nothing else. It has no knowledge of weight values, commands, or protocols.

**Class exported:** `SerialManager`

**Key methods:**

| Method | Description |
|---|---|
| `connect(config)` | Open port — requests user to select one if none previously granted |
| `disconnect()` | Gracefully close port, release all locks |
| `write(command)` | Send a command string to the scale |
| `onData(callback)` | Register callback for incoming raw byte chunks |
| `onDisconnect(callback)` | Register callback for unexpected disconnection |
| `isConnected` | Boolean getter |

**Key design decisions vs Pasigono:**

| Problem in Pasigono | Fix in SerialManager |
|---|---|
| Port opened fresh on every `getWeight()` call | Port opened once via `connect()`, kept open |
| `reader.releaseLock()` commented out — port permanently locked | `releaseLock()` always called in `finally {}` |
| Hardcoded `{baudRate: 9600, dataBits: 7, parity: "even"}` | All params from `config` object (Scale Settings) |
| No disconnect event handling | `navigator.serial` disconnect event wired up |
| No error categorisation | Every failure mapped to a `ScaleError` code |

**Parity mapping:** Frappe stores parity as `"None"/"Even"/"Odd"`. Web Serial API expects `"none"/"even"/"odd"`. `_buildOpenOptions()` handles this translation so neither the UI nor WeightService needs to know.

**Read loop:** A `while(true)` loop runs on `this._port.readable`. It feeds every incoming chunk to the registered `onData` callback. On clean `disconnect()`, `_readLoopActive` is set false before cancelling the reader. On unexpected disconnect, `_handleUnexpectedDisconnect()` fires the `onDisconnect` callback.

---

### 4.3 Parser Layer

---

#### `public/js/parsers/avery_berkel_fx120_parser.js`

**Purpose:** Decode RS232 frames from the Avery Berkel FX120 scale.

**Class exported:** `AveryBerkelFX120Parser extends IWeightParser`

**Protocol:** Mettler Toledo MT-8217 (the FX120 emulates this)

**Frame format:**
```
[STX] [stability] [sign] [NNNNN] [.] [DDD] [SP] [unit] [CR]

Byte 0    : 0x02 (STX — start of text)
Byte 1    : 0x20 (SPACE = stable) or 0x3F ('?' = unstable)
Byte 2    : '+' or '-'
Bytes 3–7 : 5-digit integer part, zero-padded
Byte 8    : '.'
Bytes 9–11: 3-digit decimal part
Byte 12   : ' ' (space)
Bytes 13–14: unit ("kg", "lb", " g", "oz")
Byte 15   : 0x0D (CR — frame terminator)
```

**Example (stable, 1.234 kg):**
```
02 20 2B 30 30 30 30 31 2E 32 33 34 20 6B 67 0D
STX SP  +  0  0  0  0  1  .  2  3  4  SP k  g CR
```

**Example (unstable):**
```
02 3F 2B 30 30 30 30 31 2E 32 33 34 20 6B 67 0D
STX  ?  + ...
```

**`canParse()`:** Checks `rawData[0] === 0x02` (STX) and `length >= 14`.

**`getFrameTerminator()`:** Returns `new Uint8Array([0x0D])` — CR byte.

---

#### `public/js/parsers/mettler_toledo_8217_parser.js`

**Purpose:** Decode RS232 frames from native Mettler Toledo scales using MT-8217.

**Class exported:** `MettlerToledo8217Parser extends IWeightParser`

**Protocol ID:** `mettler_toledo_8217`

**Frame format:** Identical to AveryBerkelFX120 — the FX120 emulates this protocol.

**Why a separate class if the format is the same:**
- The registry maps scale model → parser class. MT users get MT branding in logs and error messages.
- Future MT scales may have subtle differences (different decimal counts, different STX bytes).
- Open/Closed Principle — separate classes cost nothing and prevent future breakage.

---

#### `public/js/parsers/generic_rs232_parser.js`

**Purpose:** Best-effort fallback parser for unknown or unconfigured scales.

**Class exported:** `GenericRS232Parser extends IWeightParser`

**Protocol ID:** `generic_rs232`

**Supported formats (best-effort):**
```
"1.234\r"           bare number
"+1.234\r"          signed number
"1.234 kg\r"        number + unit
"ST,GS, 1.234kg\r"  CAS/Digi prefix format
```

**Algorithm:** Extract the first float-like token found anywhere in the frame using regex `/[+-]?\d+\.?\d*/`. Try to extract a unit (`kg`, `lb`, `g`, `oz`). Detect instability by checking for known markers (`US`, `?`).

**Limitation:** Cannot reliably detect stable vs unstable for all generic scales. If the scale uses MT-8217 format, use `AveryBerkelFX120Parser` or `MettlerToledo8217Parser` instead.

**When to use:** During initial integration of a new scale before writing a dedicated parser. Also as the automatic fallback in `ParserRegistry` when no registered parser matches.

---

#### `public/js/parsers/parser_registry.js`

**Purpose:** Maps a protocol identifier string to the correct parser class. Resolves the parser at runtime based on Scale Settings.

**Class exported:** `ParserRegistry`

**Key methods:**

| Method | Description |
|---|---|
| `ParserRegistry.register(ParserClass)` | Register a new parser (called by each parser file on load) |
| `ParserRegistry.resolve(identifier)` | Return a parser instance for the given protocol string |
| `ParserRegistry.list()` | Return all registered protocol IDs |
| `ParserRegistry.listDetails()` | Return `{id, name}` objects for UI population |

**`resolve()` matching order:**
1. Exact match on `protocolId` (e.g. `"avery_berkel_fx120"`)
2. Case-insensitive match on `protocolId` or `protocolName`
3. Partial match on `protocolName` (e.g. `"Avery Berkel"` matches `"Avery Berkel FX120 (MT-8217)"`)
4. Fallback to `GenericRS232Parser` with a console warning

**Self-registration:** Each parser file calls `ParserRegistry.register(ClassName)` at the bottom, so the registry is populated automatically in `hooks.py` load order. No manual wiring needed.

**Why it was needed:** Without a registry, `WeightService` would contain:
```javascript
if (protocol === "avery_berkel_fx120") { ... }
else if (protocol === "mettler_toledo") { ... }
// ... every new scale requires editing WeightService
```
This violates the Open/Closed Principle. With the registry, adding a new scale requires zero changes to WeightService.

---

### 4.4 Simulator

---

#### `public/js/simulator/scale_simulator.js`

**Purpose:** Software-only replacement for the serial hardware stack. Used when `debug_mode = 1` in Scale Settings. Allows full POS integration testing without a physical scale.

**Class exported:** `ScaleSimulator`

**Constructor:** `new ScaleSimulator({ debug_weight, unit })`

**Key methods:**

| Method | Description |
|---|---|
| `getWeight()` | Returns a `Promise<WeightReading>` with simulated data |
| `setWeight(newWeight)` | Change the simulated target weight mid-session |

**Simulation model:**
- Starts the simulated current value at 70% of the target weight
- Each `getWeight()` call: moves 40% of the remaining distance toward target, adds ±0.005 kg noise
- `stable = true` once 3 consecutive reads show deviation < 0.005 kg
- Simulates 120ms measurement delay (realistic for RS232 poll-response)
- If target weight is 0: returns `WeightReading.zero()` immediately (tare simulation)

**Why it was needed:** The reference project had no simulator. Every test required physical hardware connected. `ScaleSimulator` allows:
- Full POS workflow testing with no hardware
- Automated test suite that runs in CI
- Demonstration to client without a scale present
- Debugging parser issues by feeding known byte sequences

---

### 4.5 Orchestrator

---

#### `public/js/weight_service.js`

**Purpose:** Single public facade for all scale operations. The only class that callers (POSNext widget, Scale Settings form) interact with directly.

**Class exported:** `WeightService`

**Factory method:** `WeightService.fromSettings()` — loads Scale Settings via `frappe.client.get`, resolves the correct parser from `ParserRegistry`, and returns a configured instance.

**Why `frappe.client.get` and not `frappe.db.get_single_value`:**
`get_single_value` only accepts one field name at a time. `frappe.client.get` returns the complete document in one round trip.

**Responsibilities:**
- In `debug_mode`: delegates `getWeight()` to `ScaleSimulator`
- In live mode: manages `SerialManager` + `SerialBuffer` + selected `Parser`
- Implements `stable_weight_only` polling (retries until stable or gives up after 10 polls)
- Emits DOM `CustomEvent`s so POSNext can listen without being coupled to this class
- Provides `startPolling()` / `stopPolling()` for continuous weight display

**Window events emitted:**

| Event | `detail` payload | When |
|---|---|---|
| `scale:connected` | `{ model, protocol }` | After successful port open |
| `scale:disconnected` | `{ error: ScaleError \| null }` | After disconnect (clean or not) |
| `scale:weight` | `WeightReading` | Each poll result |
| `scale:error` | `ScaleError` | On recoverable errors during polling |

**`_pollOnce()` design:**
1. Register a one-shot `onFrame` callback on `SerialBuffer`
2. Set a timeout (3000ms) that rejects with `READ_TIMEOUT`
3. Send the read command via `SerialManager.write()`
4. When `SerialBuffer` emits a complete frame, parse it and resolve
5. Always clears the timeout and resets the frame handler — no memory leaks

**Constants:**

| Constant | Default | Description |
|---|---|---|
| `READ_TIMEOUT_MS` | 3000 | Give up waiting for a frame after this many ms |
| `MAX_STABLE_POLLS` | 10 | Max polls before giving up on stability |
| `POLL_INTERVAL_MS` | 500 | Default continuous polling interval |

---

### 4.6 POSNext Integration

---

#### `public/js/pos_scale_widget.js`

**Purpose:** Floating UI panel that bridges `WeightService` events to the POSNext cart.

**Class exported:** `POSScaleWidget`

**Integration philosophy — why no monkey-patching:**

Pasigono integrated by overriding the ERPNext class:
```javascript
// Pasigono — FRAGILE
erpnext.PointOfSale.ItemDetails = class extends erpnext.PointOfSale.ItemDetails { ... }
```
This broke on every ERPNext update. POSScaleWidget uses two clean seams instead:

1. **Inbound (scale → widget):** Listens to `window` CustomEvents dispatched by `WeightService`. Zero coupling to WeightService internals.

2. **Outbound (widget → POSNext cart):** Uses `InputEvent` on the quantity input element. This simulates the user typing the weight value — Vue's `v-model` reactivity picks it up through the native DOM event system, with no access to Pinia internals.

**Widget lifecycle:**
1. `POSScaleWidget.init()` — safe to call multiple times (idempotent)
2. Waits for POSNext Vue SPA to mount (polls `#app` until it has children)
3. Injects floating panel into `document.body`
4. Binds `scale:*` event listeners
5. If `auto_connect` is enabled in Scale Settings, connects immediately

**Widget UI:**

```
┌─────────────────────────┐
│ ● Weighing Scale        │
│                         │
│        1.234 kg         │
│                         │
│ [Disconnect] [Apply ▶]  │
└─────────────────────────┘
```

- Green dot = connected, amber pulsing = connecting, grey = disconnected, red = error
- Weight display: black = stable, amber = unstable, red text = error code
- Apply Weight button: disabled until `reading.isValid()` is true

**Auto-init:** The file self-initialises only when `window.location.pathname.startsWith("/pos")`. On every other Frappe desk page, it is completely inert. Also hooks `history.pushState` to handle Vue Router navigation.

**`_applyWeight()` method:** Locates the quantity input in the selected POSNext cart row using CSS selectors. Uses the native `HTMLInputElement.prototype.value` setter (bypasses Vue's wrapper) then dispatches `input` and `change` events to trigger Vue's `v-model` update. If no item is selected, shows a Frappe warning instead of failing silently.

---

### 4.7 Tests

---

#### `public/js/tests/scale_tests.js`

**Purpose:** Zero-dependency browser-based test suite. 30 tests covering every class.

**Class exported:** `ScaleTestSuite`

**How to run:**
```javascript
// In the browser console (any Frappe page with scale files loaded):
await ScaleTestSuite.run();
// or via Scale Settings → "Run Tests" button
```

**Output:**
```
ScaleTestSuite
  ✓ ScaleError carries code and message
  ✓ ScaleError.isRecoverable() — timeout is recoverable
  ✓ WeightReading stores all fields correctly
  ✓ WeightReading is frozen (immutable)
  ...
  ✓ ScaleSimulator.setWeight() changes the simulated target
30/30 passed
```

**Test coverage:**

| Class | Tests |
|---|---|
| `ScaleError` | Code storage, `isRecoverable()` for recoverable and non-recoverable codes |
| `WeightReading` | Field storage, immutability, `isValid()` (positive/zero/unstable), `toString()` with/without prefix, rejection of NaN/Infinity, factory methods |
| `SerialBuffer` | Single chunk frame, split-chunk frame, two frames in one chunk, flush behaviour |
| `AveryBerkelFX120Parser` | Stable frame, unstable frame (? byte), garbage frame throws PARSE_ERROR, `canParse()` rejects missing STX |
| `GenericRS232Parser` | Bare number, instability marker "US", non-numeric throws PARSE_ERROR |
| `ParserRegistry` | Resolve by protocolId, resolve by name, fallback to Generic for unknown, `list()` completeness |
| `ScaleSimulator` | Convergence to stable within 20 polls, zero target, `setWeight()` retarget |

**No build step, no npm, no Jest.** Runs directly in Chrome/Edge on any Frappe page where the scale JS files are already loaded.

**CI integration:** After `await ScaleTestSuite.run()`, check `window.scaleTestsFailed === 0`.

---

### 4.8 Frappe DocType

---

#### `zp_avery_weigtscale/doctype/scale_settings/scale_settings.json`

**Purpose:** Frappe Single DocType that stores all scale configuration. "Single" means there is exactly one instance of this document — like a settings page.

**Fields:**

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | Check | 0 | Master on/off switch for the integration |
| `auto_connect` | Check | 1 | Connect to scale automatically when POS opens |
| `scale_model` | Data | Avery Berkel FX120 | Hardware model name (informational) |
| `communication_type` | Select | RS232 | USB / RS232 / USB Serial / TCP/IP / Bluetooth |
| `protocol` | Data | Mettler Toledo 8217 | Maps to a `ParserRegistry` protocol ID |
| `unit` | Select | Kg | Weight unit: Kg / g / lb / oz |
| `baud_rate` | Int | — | Serial baud rate (e.g. 9600) |
| `data_bits` | Int | — | Serial data bits (e.g. 7) |
| `stop_bits` | Int | — | Serial stop bits (e.g. 1) |
| `parity` | Select | — | None / Even / Odd |
| `command` | Data | W | Command string sent to scale to request weight |
| `read_interval` | Int | 500 | Polling interval in ms |
| `stable_weight_only` | Check | 1 | Reject unstable readings and retry |
| `debug_mode` | Check | 1 | Use ScaleSimulator instead of real hardware |
| `debug_weight` | Float | 1.250 | Simulated weight value in kg |

---

#### `zp_avery_weigtscale/doctype/scale_settings/scale_settings.py`

**Purpose:** Python controller for the Scale Settings DocType. Currently minimal (inherits base `Document` class). Future hooks (`validate`, `on_update`) can be added here.

---

#### `zp_avery_weigtscale/doctype/scale_settings/scale_settings.js`

**Purpose:** Frappe form controller for the Scale Settings UI.

**Buttons added:**

| Button | Action |
|---|---|
| Test Connection | Runs the full connect → read → disconnect cycle and shows result as a Frappe alert |
| Run Tests | Executes `ScaleTestSuite.run()` and shows pass/fail alert |

**Field behaviour:**
- `debug_mode` toggle shows/hides and makes `debug_weight` required/optional dynamically

---

### 4.9 App Configuration

---

#### `hooks.py`

**Purpose:** Frappe app hooks. Registers JS files to be injected into every Frappe desk page.

**`app_include_js` load order** (dependency order — each file depends only on files above it):

```python
app_include_js = [
    # Phase 1: Core contracts
    ".../core/scale_error.js",
    ".../core/weight_reading.js",
    ".../core/i_weight_parser.js",
    # Phase 2: Serial I/O
    ".../serial/serial_buffer.js",
    ".../serial/serial_manager.js",
    # Phase 3: Parsers (concrete before registry)
    ".../parsers/avery_berkel_fx120_parser.js",
    ".../parsers/mettler_toledo_8217_parser.js",
    ".../parsers/generic_rs232_parser.js",
    ".../parsers/parser_registry.js",
    # Phase 5: Debug simulator
    ".../simulator/scale_simulator.js",
    # Phase 4: Orchestrator
    ".../weight_service.js",
    # Phase 7: POSNext widget
    ".../pos_scale_widget.js",
]
```

**Note:** The `pos_scale_widget.js` self-activates only on `/pos` pages — it is inert on all other desk pages.

---

## 5. Data Flow

### Live Scale — Single Weight Read

```
User clicks "Test Connection" in Scale Settings
    │
    ▼
WeightService.fromSettings()
    │  frappe.client.get("Scale Settings")
    ▼
config = { baud_rate: 9600, data_bits: 7, ... protocol: "avery_berkel_fx120" }
parser = ParserRegistry.resolve("avery_berkel_fx120")
    → returns new AveryBerkelFX120Parser()
service = new WeightService(config, parser, debugMode=false)
    │
    ▼
service.connect()
    │  navigator.serial.getPorts() → [port] or requestPort() prompt
    │  port.open({ baudRate: 9600, dataBits: 7, stopBits: 1, parity: "even" })
    │  Sets up TextEncoderStream → port.writable pipe
    │  Starts read loop on port.readable
    ▼
window fires "scale:connected" event
    │
    ▼
service.getWeight()   (stable_weight_only=true)
    │
    ▼
service._pollOnce()
    │  1. Register onFrame callback on SerialBuffer
    │  2. Start 3000ms timeout
    │  3. serial.write("W")  → scale receives "W" command
    │
    ▼
Scale hardware responds:
    0x02 0x20 0x2B 0x30 0x30 0x30 0x30 0x31 0x2E 0x32 0x33 0x34 0x20 0x6B 0x67 0x0D
    STX  SP   +    0    0    0    0    1    .    2    3    4    SP   k    g    CR
    │
    ▼
port.readable → read loop → onData callback
    │  chunk: Uint8Array([0x02, 0x20, ...])
    ▼
SerialBuffer.push(chunk)
    │  Scans for 0x0D terminator — found at index 15
    │  Emits complete frame: Uint8Array(16 bytes)
    ▼
WeightService._pollOnce() onFrame callback fires
    │  Clears 3000ms timeout
    │  parser.parse(frame)
    ▼
AveryBerkelFX120Parser.parse()
    │  stabilityByte = 0x20 → stable = true
    │  text = " +00001.234 kg"
    │  match[1] = "00001.234" → value = 1.234
    │  match[2] = "kg" → unit = "kg"
    ▼
WeightReading { value: 1.234, unit: "kg", stable: true, raw: "+00001.234 kg" }
    │
    ▼
Returned to Scale Settings form → frappe.show_alert("Scale read: 1.234 kg")
```

### Debug Mode — POS Workflow

```
Staff selects item in POSNext
    │
    ▼
POSScaleWidget detects "scale:weight" event (from polling loop)
    │  reading = { value: 1.234, unit: "kg", stable: true }
    ▼
Widget displays "1.234 kg" (black text = stable)
Apply Weight button becomes enabled
    │
    ▼
Staff clicks "Apply Weight"
    │
    ▼
POSScaleWidget._applyWeight(reading)
    │  qtyInput = document.querySelector(".cart-item-wrapper.selected input[type='number']")
    │  nativeInputValueSetter.call(qtyInput, 1.234)
    │  qtyInput.dispatchEvent(new Event("input",  { bubbles: true }))
    │  qtyInput.dispatchEvent(new Event("change", { bubbles: true }))
    ▼
Vue v-model updates → Pinia store updates → cart recalculates
    │  quantity = 1.234
    │  amount = 1.234 × price_per_kg
    ▼
Cart displays updated quantity and total
```

---

## 6. Design Patterns Used

| Pattern | Where | Why |
|---|---|---|
| **Strategy** | `IWeightParser` + all parser subclasses | Swap parser at runtime based on Scale Settings without changing WeightService |
| **Registry** | `ParserRegistry` | Add new scales by registering a new class — no if/else chains |
| **Value Object** | `WeightReading` | Immutable, self-describing weight measurements |
| **Template Method** | `IWeightParser` abstract base | Define the algorithm skeleton, let subclasses fill in protocol-specific steps |
| **Observer / Event** | `WeightService` → `window.CustomEvent` | POSNext reacts to scale events without being coupled to WeightService |
| **Factory** | `WeightService.fromSettings()` | Encapsulate complex construction (settings load + parser resolution) |
| **Facade** | `WeightService` | Single simple API hiding SerialManager + SerialBuffer + Parser complexity |
| **Null Object / Simulator** | `ScaleSimulator` | Replaces real hardware with identical interface — no if/else in WeightService |

---

## 7. Error Taxonomy

```
ScaleError
├── Hardware errors (NOT recoverable — human action required)
│   ├── SERIAL_NOT_SUPPORTED — change browser
│   ├── PORT_NOT_SELECTED    — user must click port picker
│   ├── PORT_ACCESS_DENIED   — OS permission / another app owns port
│   ├── PORT_ALREADY_OPEN    — call disconnect() first
│   ├── CONNECTION_FAILED    — check cable, baud rate, port
│   ├── CONNECTION_LOST      — cable unplugged — reconnect
│   └── WRITE_FAILED         — check cable
│
├── Reading errors (recoverable — system retries automatically)
│   ├── READ_TIMEOUT         — no response in 3s — retry
│   └── PARSE_ERROR          — bad bytes received — retry
│
├── Weight quality (recoverable — wait for stability)
│   └── UNSTABLE_WEIGHT      — scale not settled — wait and retry
│
└── Configuration errors (NOT recoverable — fix settings)
    ├── NO_PARSER_FOUND      — set correct Protocol in Scale Settings
    └── INVALID_CONFIG       — enable integration in Scale Settings
```

---

## 8. How to Add a New Scale

Example: adding a **CAS CI-201A** scale.

**Step 1** — Create `public/js/parsers/cas_ci201a_parser.js`:

```javascript
class CasCI201AParser extends IWeightParser {

    static get protocolId()   { return "cas_ci201a"; }
    static get protocolName() { return "CAS CI-201A"; }

    getFrameTerminator() {
        return new Uint8Array([0x0D, 0x0A]); // CRLF
    }

    canParse(rawData) {
        return rawData instanceof Uint8Array && rawData.length > 4;
    }

    parse(rawData) {
        // ... CAS-specific decoding logic
        return new WeightReading({ value, unit, stable, raw });
    }
}

ParserRegistry.register(CasCI201AParser);
window.CasCI201AParser = CasCI201AParser;
```

**Step 2** — Add to `hooks.py` before `parser_registry.js`:

```python
"/assets/zp_avery_weigtscale/js/parsers/cas_ci201a_parser.js",
```

**Step 3** — Rebuild:

```bash
bench build --app zp_avery_weigtscale
```

**Step 4** — In Scale Settings, set Protocol to `cas_ci201a` or `CAS CI-201A`.

**Zero other files change.**

---

## 9. How to Run the Tests

### Via Frappe UI

Open **Scale Settings** → click **Run Tests**.

### Via Browser Console

Open any Frappe desk page, open DevTools console:

```javascript
await ScaleTestSuite.run();
// Expected output:
// ScaleTestSuite
//   ✓ ScaleError carries code and message
//   ✓ ScaleError.isRecoverable() — timeout is recoverable
//   ... 28 more passing tests
// 30/30 passed
```

### Check result programmatically

```javascript
await ScaleTestSuite.run();
console.log(window.scaleTestsPassed); // 30
console.log(window.scaleTestsFailed); // 0
```

---

## 10. Deployment

```bash
# Build JS assets
bench build --app zp_avery_weigtscale

# Sync DocType schema to database
bench --site pos.local migrate
```

### Deprecated files (safe to delete after confirming everything works)

The following root-level files were the original implementation and are no longer referenced in `hooks.py`:

- `public/js/serial_manager.js` — replaced by `serial/serial_manager.js`
- `public/js/weight_parser.js` — replaced by the `parsers/` directory
- `public/js/scale_worker.js` — never implemented (was empty)

The root `public/js/weight_service.js` has been **rewritten in place** as the Phase 4 orchestrator — it is the current active file.

---

## 11. What Was Wrong With the Reference

The reference project (Pasigono, version-14 branch, `pos_mettler_toledo.js`) had the following issues. All are fixed in this implementation.

| Issue | Severity | Detail |
|---|---|---|
| `strWeight.concat(response)` — result discarded | **Critical bug** | `.concat()` in JS returns a new string; it does not mutate. Partial frames from split read() calls were silently lost, causing incorrect or missing weight values |
| `reader.releaseLock()` commented out | **Critical bug** | Port permanently locked after first read. Required page reload to reconnect |
| Global variables `var port`, `var weight`, `var weightLoop` | Architecture | No encapsulation. State shared across all code on the page |
| `setTimeout(fn, 300)` described as "a hack to circumvent a bug" | Architecture | Timing-based logic is non-deterministic. Fails under different system loads |
| `catch(error) { //TODO }` everywhere | Architecture | All errors silently swallowed. Impossible to debug production issues |
| Hardcoded `{baudRate: 9600, dataBits: 7, parity: "even"}` in worker | Architecture | Cannot support different scales without code changes |
| `decodeData()` inside the worker | Architecture | Parser tightly coupled to serial I/O. Cannot be tested or reused |
| `erpnext.PointOfSale.ItemDetails = class extends ...` | Architecture | Monkey-patching a core ERPNext class. Breaks on every upstream update |
| `window.mettlerWorker`, `window.weight`, `window.enable_weigh_scale` | Architecture | Global namespace pollution |
| No stability detection | Feature gap | `if(newWeight != weight)` is not stability detection — it only checks for change |
| No error taxonomy | Feature gap | Single generic Error with no codes for different failure modes |
| No debug/simulator mode | Feature gap | Every test required physical hardware |
| No frame boundary handling | Feature gap | Assumed each `read()` call returned exactly one complete frame |
