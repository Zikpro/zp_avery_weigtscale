app_name = "zp_avery_weigtscale"
app_title = "Zp Avery Weigtscale"
app_publisher = "Zikpro Ltd."
app_description = "Avery Berkel FX120 Weight scale integration with POSNext"
app_email = "seemab@zikpro.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []
extend_bootinfo = "zp_avery_weigtscale.boot.extend_bootinfo"

_scale_js = [
    # Load order matters: each file depends only on files above it.
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

# Frappe desk pages (Scale Settings form, Run Tests button)
app_include_js = _scale_js

# Web pages — picks up pos.html which uses {% for link in web_include_js %}
web_include_js = _scale_js

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "zp_avery_weigtscale",
# 		"logo": "/assets/zp_avery_weigtscale/logo.png",
# 		"title": "Zp Avery Weigtscale",
# 		"route": "/zp_avery_weigtscale",
# 		"has_permission": "zp_avery_weigtscale.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/zp_avery_weigtscale/css/zp_avery_weigtscale.css"
# app_include_js = "/assets/zp_avery_weigtscale/js/zp_avery_weigtscale.js"

# include js, css files in header of web template
# web_include_css = "/assets/zp_avery_weigtscale/css/zp_avery_weigtscale.css"
# web_include_js = "/assets/zp_avery_weigtscale/js/zp_avery_weigtscale.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "zp_avery_weigtscale/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "zp_avery_weigtscale/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "zp_avery_weigtscale.utils.jinja_methods",
# 	"filters": "zp_avery_weigtscale.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "zp_avery_weigtscale.install.before_install"
# after_install = "zp_avery_weigtscale.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "zp_avery_weigtscale.uninstall.before_uninstall"
# after_uninstall = "zp_avery_weigtscale.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "zp_avery_weigtscale.utils.before_app_install"
# after_app_install = "zp_avery_weigtscale.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "zp_avery_weigtscale.utils.before_app_uninstall"
# after_app_uninstall = "zp_avery_weigtscale.utils.after_app_uninstall"

# Build
# ------------------
# To hook into the build process

# after_build = "zp_avery_weigtscale.build.after_build"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "zp_avery_weigtscale.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"zp_avery_weigtscale.tasks.all"
# 	],
# 	"daily": [
# 		"zp_avery_weigtscale.tasks.daily"
# 	],
# 	"hourly": [
# 		"zp_avery_weigtscale.tasks.hourly"
# 	],
# 	"weekly": [
# 		"zp_avery_weigtscale.tasks.weekly"
# 	],
# 	"monthly": [
# 		"zp_avery_weigtscale.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "zp_avery_weigtscale.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "zp_avery_weigtscale.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "zp_avery_weigtscale.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "zp_avery_weigtscale.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["zp_avery_weigtscale.utils.before_request"]
# after_request = ["zp_avery_weigtscale.utils.after_request"]

# Job Events
# ----------
# before_job = ["zp_avery_weigtscale.utils.before_job"]
# after_job = ["zp_avery_weigtscale.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"zp_avery_weigtscale.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

