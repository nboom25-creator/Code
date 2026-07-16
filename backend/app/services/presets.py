"""Intended-use presets.

A preset pre-fills questionnaire prompts and suggests which questions matter.
It NEVER creates loads, constraints, or magnitudes — those must be entered by
the user in the boundary-condition editor.
"""

USE_CASE_PRESETS: dict[str, dict] = {
    "mounting_bracket": {
        "label": "Mounting bracket",
        "suggested_flags": ["structural", "load_bearing"],
        "prompts": [
            "What is bolted to the bracket, and how heavy is it?",
            "Which holes/faces are fixed to the supporting structure?",
            "Is the load static, or does it vibrate/shock?",
        ],
    },
    "shaft_coupling": {
        "label": "Shaft coupling",
        "suggested_flags": ["structural", "rotating", "fatigue_loaded"],
        "prompts": ["Transmitted torque?", "Shaft diameters and key/clamp style?", "Operating RPM?"],
    },
    "enclosure": {
        "label": "Enclosure",
        "suggested_flags": ["cosmetic"],
        "prompts": ["Ingress protection needs?", "Snap fits or screws?", "Heat sources inside?"],
    },
    "lever": {
        "label": "Lever / handle",
        "suggested_flags": ["structural", "load_bearing"],
        "prompts": ["Hand force and direction?", "Pivot location?", "Impact or drop loading?"],
    },
    "gear_pulley": {
        "label": "Gear or pulley",
        "suggested_flags": ["structural", "rotating", "fatigue_loaded"],
        "prompts": ["Torque and speed?", "Belt tension or tooth load?", "Bore/keyway interface?"],
    },
    "pressure_housing": {
        "label": "Pressure housing",
        "suggested_flags": ["structural", "pressure_containing", "safety_critical"],
        "prompts": [
            "Internal or external pressure, and magnitude?",
            "Sealing method?",
            "Note: pressure vessels can be safety-critical; preliminary FEA here is NOT a code-compliance calculation.",
        ],
    },
    "pipe_fitting": {
        "label": "Pipe fitting",
        "suggested_flags": ["fluid_containing", "pressure_containing"],
        "prompts": ["Line pressure?", "Fluid and temperature?", "Thread or flange standard?"],
    },
    "drone_robot": {
        "label": "Drone / robot structure",
        "suggested_flags": ["structural", "load_bearing", "fatigue_loaded"],
        "prompts": ["Mass supported and flight/impact loads?", "Vibration sources?", "Weight target?"],
    },
    "underwater": {
        "label": "Underwater component",
        "suggested_flags": ["structural", "pressure_containing"],
        "prompts": ["Depth (external pressure)?", "Salt or fresh water?", "Trapped air volumes to flood or seal?"],
    },
    "printed_prototype": {
        "label": "3D-printed prototype",
        "suggested_flags": [],
        "prompts": ["Which printer/process?", "Orientation on the bed?", "Any functional loads at all?"],
    },
    "machined_part": {
        "label": "Machined production part",
        "suggested_flags": ["structural"],
        "prompts": ["3-axis accessible?", "Internal corner radii vs. cutter size?", "Tolerance-critical features?"],
    },
    "custom": {"label": "Custom", "suggested_flags": [], "prompts": []},
}

QUESTIONNAIRE_FIELDS = [
    # (key, label, type)
    ("function", "What does the part do?", "text"),
    ("flags", "Roles: structural / cosmetic / fluid-containing / pressure-containing / rotating / "
              "load-bearing / impact-loaded / fatigue-loaded / safety-critical", "multiselect"),
    ("exposures", "Contacts: people / food / chemicals / water / salt water / fuel / oil / heat / UV / vacuum / pressure", "multiselect"),
    ("service_life", "Expected service life", "text"),
    ("environment", "Indoor or outdoor use", "select"),
    ("temp_min_c", "Minimum service temperature (deg C)", "number"),
    ("temp_max_c", "Maximum service temperature (deg C)", "number"),
    ("loading", "Static or cyclic loading", "select"),
    ("cycle_count", "Approximate cycle count (if cyclic)", "number"),
    ("target_safety_factor", "Desired safety factor", "number"),
    ("weight_goal", "Weight-reduction goal", "text"),
    ("stiffness_goal", "Stiffness goal", "text"),
    ("cost_goal", "Cost goal", "text"),
    ("min_feature_size", "Minimum manufacturable feature size (with units)", "text"),
    ("dimension_change_allowance", "Allowed overall-dimension changes", "text"),
    ("protected_interfaces", "Protected surfaces, holes, interfaces, keep-out regions", "text"),
]
