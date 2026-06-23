/**
 * POSScaleWidget — floating UI widget that bridges WeightService and POSNext.
 *
 * No dependency on the Frappe JS library. Uses plain fetch() for API calls
 * so it works on the standalone POSNext page (/pos) which does not load frappe.js.
 *
 * UX flow (supermarket style):
 *   1. Staff places product on scale.
 *   2. Scale widget shows live weight (continuous polling).
 *   3. Staff clicks item in POSNext → Edit Item Details dialog opens.
 *   4. Weight auto-fills into the Quantity field immediately.
 *   5. Staff clicks "Update Item" → done.
 *
 * No manual "Apply Weight" click required.
 * The manual button remains as a fallback.
 */
class POSScaleWidget {

	static _instance = null;

	static init() {
		if (POSScaleWidget._instance) return;
		POSScaleWidget._instance = new POSScaleWidget();
		POSScaleWidget._instance._boot();
	}

	constructor() {
		this._service      = null;
		this._lastReading  = null;
		this._el           = null;
		this._weightEl     = null;
		this._statusEl     = null;
		this._connectBtn   = null;
		this._applyBtn     = null;
		this._dialogObserver = null;
	}

	// =========================================================================
	// Boot
	// =========================================================================

	async _boot() {
		await POSScaleWidget._waitForPOSMount();
		this._injectPanel();
		this._bindScaleEvents();
		this._bindButtonEvents();
		this._watchForDialog();
		this._autoConnectIfConfigured();
	}

	// =========================================================================
	// Panel
	// =========================================================================

	_injectPanel() {
		const panel = document.createElement("div");
		panel.id    = "scale-widget";
		panel.innerHTML = `
			<div class="scale-widget-inner">
				<div class="scale-widget-header">
					<span id="scale-status-dot" class="scale-dot scale-dot--disconnected"></span>
					<span class="scale-widget-title">Weighing Scale</span>
				</div>
				<div id="scale-weight-display" class="scale-weight">— kg</div>
				<div class="scale-widget-actions">
					<button id="scale-connect-btn" class="scale-btn scale-btn--secondary">Connect</button>
					<button id="scale-apply-btn"   class="scale-btn scale-btn--primary" disabled>Apply Weight</button>
				</div>
			</div>
		`;

		panel.style.cssText = `
			position: fixed;
			bottom: 24px;
			right: 24px;
			z-index: 9999;
			background: #ffffff;
			border: 1px solid #d1d5db;
			border-radius: 12px;
			box-shadow: 0 4px 24px rgba(0,0,0,0.12);
			padding: 14px 16px;
			min-width: 180px;
			font-family: inherit;
			user-select: none;
		`;

		POSScaleWidget._injectStyles();
		document.body.appendChild(panel);

		this._el         = panel;
		this._weightEl   = panel.querySelector("#scale-weight-display");
		this._statusEl   = panel.querySelector("#scale-status-dot");
		this._connectBtn = panel.querySelector("#scale-connect-btn");
		this._applyBtn   = panel.querySelector("#scale-apply-btn");
	}

	static _injectStyles() {
		if (document.getElementById("scale-widget-styles")) return;
		const style = document.createElement("style");
		style.id    = "scale-widget-styles";
		style.textContent = `
			.scale-widget-inner { display: flex; flex-direction: column; gap: 10px; }
			.scale-widget-header { display: flex; align-items: center; gap: 6px; }
			.scale-widget-title { font-size: 12px; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; }
			.scale-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
			.scale-dot--connected    { background: #22c55e; }
			.scale-dot--connecting   { background: #f59e0b; animation: scale-pulse 1s infinite; }
			.scale-dot--disconnected { background: #d1d5db; }
			.scale-dot--error        { background: #ef4444; }
			.scale-weight { font-size: 28px; font-weight: 700; color: #111827; text-align: center; letter-spacing: -0.02em; min-height: 36px; }
			.scale-weight--unstable { color: #f59e0b; }
			.scale-weight--error    { color: #ef4444; font-size: 13px; font-weight: 500; }
			.scale-widget-actions { display: flex; gap: 6px; }
			.scale-btn { flex: 1; padding: 6px 10px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: 500; transition: opacity 0.15s; }
			.scale-btn:disabled { opacity: 0.4; cursor: default; }
			.scale-btn--primary   { background: #2563eb; color: #fff; }
			.scale-btn--secondary { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }
			.scale-btn--danger    { background: #ef4444; color: #fff; }
			@keyframes scale-pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
		`;
		document.head.appendChild(style);
	}

	// =========================================================================
	// Scale event listeners
	// =========================================================================

	_bindScaleEvents() {
		window.addEventListener("scale:connected", () => {
			this._setStatus("connected");
			this._connectBtn.textContent = "Disconnect";
			this._connectBtn.classList.replace("scale-btn--secondary", "scale-btn--danger");
		});

		window.addEventListener("scale:disconnected", () => {
			this._setStatus("disconnected");
			this._weightEl.textContent = "— kg";
			this._weightEl.className   = "scale-weight";
			this._applyBtn.disabled    = true;
			this._connectBtn.textContent = "Connect";
			this._connectBtn.classList.replace("scale-btn--danger", "scale-btn--secondary");
		});

		window.addEventListener("scale:weight", (event) => {
			const reading = event.detail;
			this._lastReading = reading;
			this._weightEl.textContent = reading.toString();
			this._weightEl.className   = reading.stable
				? "scale-weight"
				: "scale-weight scale-weight--unstable";
			this._applyBtn.disabled = !reading.isValid();
		});

		window.addEventListener("scale:error", (event) => {
			const err = event.detail;
			this._weightEl.textContent = err.code || "Error";
			this._weightEl.className   = "scale-weight scale-weight--error";
		});
	}

	_bindButtonEvents() {
		this._connectBtn.addEventListener("click", () => {
			if (this._service?.isConnected) {
				this._doDisconnect();
			} else {
				this._doConnect();
			}
		});

		this._applyBtn.addEventListener("click", () => {
			if (this._lastReading?.isValid()) {
				this._applyWeight(this._lastReading);
			}
		});
	}

	// =========================================================================
	// Auto-fill when Edit Item Details dialog opens
	// =========================================================================

	/**
	 * Watch the DOM for POSNext's Edit Item Details dialog appearing.
	 * When it opens and we have a valid stable reading, auto-fill quantity.
	 * This gives the supermarket POS experience — no button click needed.
	 */
	_watchForDialog() {
		this._dialogObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (node.nodeType !== 1) continue;

					// POSNext's dialog renders with class "dialog-content"
					const dialog = node.classList?.contains("dialog-content")
						? node
						: node.querySelector?.(".dialog-content");

					if (dialog) {
						// Small delay so Vue finishes rendering the input
						setTimeout(() => this._onDialogOpened(dialog), 80);
					}
				}
			}
		});

		this._dialogObserver.observe(document.body, {
			childList : true,
			subtree   : true,
		});
	}

	_onDialogOpened(dialog) {
		if (!this._lastReading?.isValid()) return;

		const qtyInput = POSScaleWidget._findQtyInput(dialog);
		if (!qtyInput) return;

		POSScaleWidget._setInputValue(qtyInput, this._lastReading.value);
		console.info(`[ScaleWidget] Auto-filled ${this._lastReading.toString()} into dialog`);
	}

	// =========================================================================
	// Connect / disconnect
	// =========================================================================

	async _doConnect() {
		this._setStatus("connecting");
		this._connectBtn.disabled = true;

		try {
			this._service = await WeightService.fromSettings();
			await this._service.connect();
			this._service.startPolling();
		} catch (err) {
			this._setStatus("error");
			console.error("[ScaleWidget]", err.toString());
			this._weightEl.textContent = err.message;
			this._weightEl.className   = "scale-weight scale-weight--error";
		} finally {
			this._connectBtn.disabled = false;
		}
	}

	async _doDisconnect() {
		if (this._service) {
			await this._service.disconnect();
			this._service = null;
		}
	}

	async _autoConnectIfConfigured() {
		try {
			const res  = await fetch("/api/resource/Scale Settings/Scale Settings", {
				headers: { "Accept": "application/json" },
			});
			if (!res.ok) return;
			const json = await res.json();
			const doc  = json.data;
			if (doc.enabled && doc.auto_connect) {
				await this._doConnect();
			}
		} catch {
			// Not logged in yet or settings unavailable — skip silently
		}
	}

	// =========================================================================
	// Manual apply (fallback button)
	// =========================================================================

	_applyWeight(reading) {
		// Look in open dialog first, then anywhere on page
		const dialog   = document.querySelector(".dialog-content");
		const qtyInput = dialog
			? POSScaleWidget._findQtyInput(dialog)
			: null;

		if (!qtyInput) {
			// Flash message in widget
			const prev      = this._weightEl.textContent;
			const prevClass = this._weightEl.className;
			this._weightEl.textContent = "Open item to apply";
			this._weightEl.className   = "scale-weight scale-weight--error";
			setTimeout(() => {
				this._weightEl.textContent = prev;
				this._weightEl.className   = prevClass;
			}, 2000);
			return;
		}

		POSScaleWidget._setInputValue(qtyInput, reading.value);
		console.info(`[ScaleWidget] Applied ${reading.toString()} to dialog`);
	}

	// =========================================================================
	// Static helpers
	// =========================================================================

	/**
	 * Find the quantity input inside a dialog.
	 * The EditItemDialog quantity input has inputmode="decimal" and is the
	 * first such input — rate and discount inputs come after it.
	 */
	static _findQtyInput(container) {
		return container.querySelector('input[inputmode="decimal"][type="number"]')
			|| container.querySelector('input[type="number"]');
	}

	/**
	 * Set an input value in a way that triggers Vue's v-model reactivity.
	 * Vue caches the last value it set; using the native setter bypasses
	 * that cache so the next 'input' event is not ignored.
	 */
	static _setInputValue(input, value) {
		const nativeSetter = Object.getOwnPropertyDescriptor(
			window.HTMLInputElement.prototype, "value"
		).set;
		nativeSetter.call(input, value);
		input.dispatchEvent(new Event("input",  { bubbles: true }));
		input.dispatchEvent(new Event("change", { bubbles: true }));
	}

	_setStatus(state) {
		this._statusEl.className = `scale-dot scale-dot--${state}`;
	}

	static _waitForPOSMount(timeoutMs = 10000) {
		return new Promise((resolve) => {
			const start   = Date.now();
			const checker = setInterval(() => {
				const app = document.querySelector("#app");
				if (app && app.children.length > 0) {
					clearInterval(checker);
					resolve();
				} else if (Date.now() - start > timeoutMs) {
					clearInterval(checker);
					resolve();
				}
			}, 100);
		});
	}
}

// Auto-init only on the /pos page
if (window.location.pathname.startsWith("/pos")) {
	document.addEventListener("DOMContentLoaded", () => POSScaleWidget.init());

	const _push = history.pushState.bind(history);
	history.pushState = function (...args) {
		_push(...args);
		if (window.location.pathname.startsWith("/pos")) {
			POSScaleWidget.init();
		}
	};
}

window.POSScaleWidget = POSScaleWidget;
