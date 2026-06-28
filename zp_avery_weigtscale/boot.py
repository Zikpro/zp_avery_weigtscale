SCALE_SCRIPTS = [
	"/assets/zp_avery_weigtscale/js/core/scale_error.js",
	"/assets/zp_avery_weigtscale/js/core/weight_reading.js",
	"/assets/zp_avery_weigtscale/js/core/i_weight_parser.js",
	"/assets/zp_avery_weigtscale/js/serial/serial_buffer.js",
	"/assets/zp_avery_weigtscale/js/serial/serial_manager.js",
	"/assets/zp_avery_weigtscale/js/parsers/avery_berkel_fx120_parser.js",
	"/assets/zp_avery_weigtscale/js/parsers/mettler_toledo_8217_parser.js",
	"/assets/zp_avery_weigtscale/js/parsers/generic_rs232_parser.js",
	"/assets/zp_avery_weigtscale/js/parsers/parser_registry.js",
	"/assets/zp_avery_weigtscale/js/simulator/scale_simulator.js",
	"/assets/zp_avery_weigtscale/js/weight_service.js",
	"/assets/zp_avery_weigtscale/js/pos_scale_widget.js",
	"/assets/zp_avery_weigtscale/js/tests/scale_tests.js",
]


def extend_bootinfo(bootinfo):
	bootinfo.scale_scripts = SCALE_SCRIPTS
