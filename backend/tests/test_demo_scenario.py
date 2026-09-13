"""Regression tests for the demo script's intervention formatting.

``data/scripts/demo_scenario.py`` is stdlib-only and lives outside the backend
package, so it is loaded by path rather than imported. Only the pure formatting
helpers are exercised here — nothing in this module touches the API.
"""

import importlib.util
from pathlib import Path

import pytest

DEMO_SCRIPT = (
    Path(__file__).resolve().parents[2] / "data" / "scripts" / "demo_scenario.py"
)


def _load_demo_module():
    spec = importlib.util.spec_from_file_location("ripple_demo_scenario", DEMO_SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def demo():
    assert DEMO_SCRIPT.is_file(), f"demo script not found at {DEMO_SCRIPT}"
    return _load_demo_module()


def test_add_edge_recommendation_does_not_crash_on_null_capacity(demo):
    """An add_edge recommendation carries proposed_capacity=None.

    Formatting it with ``:.1f`` raised TypeError and aborted the demo at step 5
    whenever a redundancy link ranked first.
    """
    rec = {
        "intervention_type": "add_edge",
        "proposed_capacity": None,
        "node_id": "11111111-2222-3333-4444-555555555555",
        "display_name": "Manipal Substation",
        "target_display_name": "KMC Hospital Feeder",
    }

    described = demo.describe_intervention(rec)

    assert described
    assert "Manipal Substation" in described
    assert "KMC Hospital Feeder" in described
    assert "upgrade" not in described
    assert "None" not in described


def test_add_edge_falls_back_through_target_name_ladder(demo):
    """Target resolves display_name -> node_name -> truncated id."""
    base = {
        "intervention_type": "add_edge",
        "proposed_capacity": None,
        "node_id": "aaaaaaaa-0000-0000-0000-000000000000",
        "display_name": "Source Asset",
    }

    by_node_name = demo.describe_intervention({**base, "target_node_name": "Raw Target"})
    assert "Raw Target" in by_node_name

    by_id = demo.describe_intervention(
        {**base, "target_node_id": "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"}
    )
    assert "bbbbbbbb" in by_id

    unresolved = demo.describe_intervention(base)
    assert unresolved
    assert "None" not in unresolved


def test_upgrade_node_recommendation_formats_capacity(demo):
    rec = {
        "intervention_type": "upgrade_node",
        "proposed_capacity": 137.5,
        "node_id": "99999999-8888-7777-6666-555555555555",
        "display_name": "Udupi Feeder",
    }

    described = demo.describe_intervention(rec)

    assert "upgrade" in described
    assert "Udupi Feeder" in described
    assert "137.5" in described


def test_upgrade_node_without_capacity_omits_the_parenthetical(demo):
    """Defensive: a missing capacity must not render as 'None' or raise."""
    described = demo.describe_intervention(
        {
            "intervention_type": "upgrade_node",
            "node_id": "77777777-6666-5555-4444-333333333333",
            "node_name": "Fallback Name",
        }
    )

    assert "Fallback Name" in described
    assert "None" not in described


def test_recommendation_label_falls_back_to_truncated_node_id(demo):
    label = demo.recommendation_label(
        {"node_id": "abcdef12-3456-7890-abcd-ef1234567890"}
    )

    assert label == "abcdef12"
