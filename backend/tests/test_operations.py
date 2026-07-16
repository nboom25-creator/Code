import numpy as np
import pytest

from app.services.operations import (
    OperationError,
    apply_operation,
    validate_operation,
    validate_result,
)
from app.services.variants import build_ops_from_recommendations, generate_variant

from .fixtures import cube, thin_wall_bracket


def test_unknown_op_rejected():
    with pytest.raises(OperationError, match="Unknown operation type"):
        validate_operation({"op_type": "teleport_atoms"})


def test_schema_validation():
    with pytest.raises(OperationError, match="schema validation"):
        validate_operation({"op_type": "add_rib", "start": [0, 0, 0]})  # missing fields
    with pytest.raises(OperationError, match="schema validation"):
        validate_operation({"op_type": "thicken_region", "triangle_indices": [1], "offset": -1})


def test_add_rib_increases_volume():
    m = cube(10)
    op = validate_operation({"op_type": "add_rib", "start": [2, 5, 10], "end": [8, 5, 10],
                             "height_dir": [0, 0, 1], "height": 3, "thickness": 2})
    out = apply_operation(m, op)
    assert out.is_watertight
    assert out.volume > m.volume


def test_remove_pocket_decreases_volume():
    m = cube(10)
    op = validate_operation({"op_type": "remove_pocket", "center": [5, 5, 10],
                             "size": [4, 4, 4]})
    out = apply_operation(m, op)
    assert out.is_watertight
    assert out.volume < m.volume


def test_protected_region_rejection():
    m = thin_wall_bracket()
    centers = m.triangles_center
    # protect the bottom-face area the pocket would cut through
    bottom = np.nonzero((np.abs(centers[:, 2]) < 1e-3)
                        & (np.linalg.norm(centers[:, :2] - np.array([30.0, 20.0]), axis=1) < 8))[0]
    # a pocket removed straight through the protected bottom face must be rejected
    op = validate_operation({"op_type": "remove_pocket", "center": [30, 20, 0],
                             "size": [10, 10, 6],
                             "protected_triangle_indices": bottom.tolist()})
    out = apply_operation(m, op)
    problems = validate_result(m, out, op)
    assert any("protected region" in p for p in problems)


def test_bbox_growth_limit():
    m = cube(10)
    op = validate_operation({"op_type": "add_rib", "start": [2, 5, 10], "end": [8, 5, 10],
                             "height_dir": [0, 0, 1], "height": 8, "thickness": 2,
                             "validation": {"max_bbox_growth_fraction": 0.05}})
    out = apply_operation(m, op)
    problems = validate_result(m, out, op)
    assert any("bounding box" in p for p in problems)


def test_smooth_region_stays_watertight():
    m = thin_wall_bracket()
    tri = list(range(0, 400))
    op = validate_operation({"op_type": "smooth_region", "triangle_indices": tri,
                             "iterations": 6})
    out = apply_operation(m, op)
    assert out.is_watertight


def test_variant_generation_bracket():
    m = thin_wall_bracket()
    recs = [{
        "id": "r1", "severity": "high", "auto_generatable": True,
        "title": "gusset", "proposed_change": "add gusset",
        "auto_op": {"op_type": "add_gusset", "params": {
            "corner_point": [30, 37, 5], "normal_a": [0, 0, 1], "normal_b": [0, -1, 0],
            "patch_centroid_a": [30, 18, 5], "patch_centroid_b": [30, 37, 30],
            "junction_dir": [1, 0, 0], "leg": 15.0, "width": 12.0}},
    }]
    ops = build_ops_from_recommendations(recs, "conservative", protected_tri=[])
    assert ops and ops[0]["op_type"] == "add_gusset"
    assert ops[0]["leg"] == pytest.approx(15.0 * 0.7)  # conservative scaling
    result = generate_variant(m, ops, "conservative", "mm", 1e-3, 2700)
    assert result.error is None
    assert result.mesh is not None and result.mesh.is_watertight
    assert result.mesh.volume > m.volume
    assert result.ops[0].status == "applied"


def test_variant_no_ops():
    result = generate_variant(cube(), [], "balanced", "mm", 1e-3, 2700)
    assert result.mesh is None
    assert "No auto-generatable operations" in result.error
