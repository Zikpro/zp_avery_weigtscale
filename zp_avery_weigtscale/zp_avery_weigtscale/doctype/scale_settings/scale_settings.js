// Copyright (c) 2026, Zikpro Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Scale Settings", {

	refresh(frm) {
		frm.add_custom_button(__("Test Connection"), async () => {
			frappe.show_alert({ message: __("Connecting to scale…"), indicator: "blue" });

			try {
				const service = await WeightService.fromSettings();
				await service.connect();

				frappe.show_alert({ message: __("Connected. Reading weight…"), indicator: "blue" });

				const reading = await service.getWeight();

				await service.disconnect();

				frappe.show_alert({
					message   : __("Scale read: ") + reading.toString(),
					indicator : reading.isValid() ? "green" : "orange",
				});

			} catch (err) {
				frappe.msgprint({
					title     : __("Connection Failed"),
					message   : err.message || String(err),
					indicator : "red",
				});
			}
		});

		frm.add_custom_button(__("Run Tests"), async () => {
			if (typeof ScaleTestSuite === "undefined") {
				frappe.msgprint({
					title   : __("Tests Not Loaded"),
					message : __("Load the test page to run the test suite."),
				});
				return;
			}
			const passed = await ScaleTestSuite.run();
			frappe.show_alert({
				message   : passed ? __("All tests passed") : __("Some tests failed — check console"),
				indicator : passed ? "green" : "red",
			});
		});
	},

	debug_mode(frm) {
		frm.toggle_reqd("debug_weight", frm.doc.debug_mode);
		frm.toggle_display("debug_weight", frm.doc.debug_mode);
	},
});
