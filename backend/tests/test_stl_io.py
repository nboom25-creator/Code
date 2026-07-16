import pytest

from app.services.stl_io import MeshFileError, detect_stl_format, validate_and_load

from .fixtures import ascii_stl_bytes, binary_stl_bytes, corrupted_stl_bytes, cube


def test_detect_binary():
    assert detect_stl_format(binary_stl_bytes(cube())) == "stl_binary"


def test_detect_ascii():
    assert detect_stl_format(ascii_stl_bytes(cube())) == "stl_ascii"


def test_load_binary():
    loaded = validate_and_load(binary_stl_bytes(cube()), "cube.stl")
    assert loaded.file_format == "stl_binary"
    assert len(loaded.mesh.faces) == 12


def test_load_ascii():
    loaded = validate_and_load(ascii_stl_bytes(cube()), "cube.stl")
    assert loaded.file_format == "stl_ascii"
    assert len(loaded.mesh.faces) == 12


def test_corrupted_rejected():
    with pytest.raises(MeshFileError, match="does not parse as a valid STL"):
        validate_and_load(corrupted_stl_bytes(), "bad.stl")


def test_empty_rejected():
    with pytest.raises(MeshFileError, match="empty"):
        validate_and_load(b"", "x.stl")


def test_wrong_extension_rejected():
    with pytest.raises(MeshFileError, match="Unsupported file type"):
        validate_and_load(binary_stl_bytes(cube()), "cube.step")


def test_size_limit(monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "max_upload_bytes", 100)
    with pytest.raises(MeshFileError, match="limit"):
        validate_and_load(binary_stl_bytes(cube()), "cube.stl")


def test_triangle_limit(monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "max_triangles", 4)
    with pytest.raises(MeshFileError, match="triangles"):
        validate_and_load(binary_stl_bytes(cube()), "cube.stl")
