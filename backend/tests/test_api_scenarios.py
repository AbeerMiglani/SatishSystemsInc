"""
Unit and schema tests for scenario API and UpgradeNodeModification.
Verifies:
1. Pydantic validation of UpgradeNodeModification and ScenarioCreate discriminated union.
2. In-memory graph modification via apply_scenario_modifications.
3. Network node existence validation in create_scenario endpoint.
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import sys
import uuid
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock

import networkx as nx
import pytest

# Ensure backend directory is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _need_mock(name: str) -> bool:
    if name in sys.modules:
        mod = sys.modules[name]
        if getattr(mod, "__spec__", None) is None:
            mod.__spec__ = importlib.machinery.ModuleSpec(name, None)
        return False
    try:
        spec = importlib.util.find_spec(name)
        return spec is None
    except (ValueError, ModuleNotFoundError):
        return True


def _make_mock_module(name: str) -> ModuleType:
    if name in sys.modules:
        mod = sys.modules[name]
        if getattr(mod, "__spec__", None) is None:
            mod.__spec__ = importlib.machinery.ModuleSpec(name, None)
        return mod
    mod = ModuleType(name)
    mod.__spec__ = importlib.machinery.ModuleSpec(name, None)
    sys.modules[name] = mod
    return mod


# Lightweight test shims if running in lean venv without full drivers
if _need_mock("pydantic"):
    pyd = _make_mock_module("pydantic")
    class BaseModel:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)
        def model_dump(self, mode=None, exclude_none=False):
            res = {}
            for k, v in self.__dict__.items():
                if exclude_none and v is None:
                    continue
                res[k] = v
            return res
    pyd.BaseModel = BaseModel
    def Field(*args, default=None, default_factory=None, **kwargs):
        return default
    pyd.Field = Field
    def field_validator(*fields, **kwargs):
        def dec(fn): return fn
        return dec
    pyd.field_validator = field_validator
    def model_validator(*args, **kwargs):
        def dec(fn): return fn
        return dec
    pyd.model_validator = model_validator
    pyd.ConfigDict = lambda **kw: kw
    pyd.UUID4 = uuid.UUID

if _need_mock("pydantic_settings"):
    _make_mock_module("pydantic_settings")

if "app.config" not in sys.modules:
    mock_cfg = _make_mock_module("app.config")
    mock_settings = MagicMock()
    mock_settings.max_scenario_modifications = 50
    mock_settings.max_initial_failures = 10
    mock_cfg.settings = mock_settings

if _need_mock("fastapi"):
    fa = _make_mock_module("fastapi")
    class APIRouter:
        def __init__(self, *args, **kwargs): pass
        def post(self, *args, **kwargs):
            def dec(fn): return fn
            return dec
        def get(self, *args, **kwargs):
            def dec(fn): return fn
            return dec
    fa.APIRouter = APIRouter
    fa.Depends = lambda x: x
    fa.Query = lambda default=None, **kw: default
    class HTTPException(Exception):
        def __init__(self, status_code, detail=None):
            self.status_code = status_code
            self.detail = detail
    fa.HTTPException = HTTPException

if _need_mock("celery"):
    cel = _make_mock_module("celery")
    cel.shared_task = lambda *args, **kwargs: (lambda fn: fn)

if _need_mock("sqlalchemy"):
    class MockColumn:
        def __init__(self, *args, **kwargs):
            self.default = kwargs.get("default")
        def __set_name__(self, owner, name):
            self.name = name
        def __get__(self, instance, owner):
            if instance is None:
                return self
            return instance.__dict__.get(self.name, self.default() if callable(self.default) else self.default)
        def __set__(self, instance, value):
            instance.__dict__[self.name] = value
        def __eq__(self, other):
            return MagicMock()

    mock_sa = _make_mock_module("sqlalchemy")
    mock_sa.Column = MockColumn
    mock_sa.String = MagicMock()
    mock_sa.Integer = MagicMock()
    mock_sa.Float = MagicMock()
    mock_sa.Boolean = MagicMock()
    mock_sa.DateTime = MagicMock()
    mock_sa.JSON = MagicMock()
    mock_sa.Enum = MagicMock()
    mock_sa.ForeignKey = MagicMock()
    mock_sa.CheckConstraint = MagicMock()
    mock_sa.UniqueConstraint = MagicMock()

    def mock_validates(*names):
        def decorator(fn):
            fn._sa_validates = names
            return fn
        return decorator

    mock_sa_orm = _make_mock_module("sqlalchemy.orm")
    mock_sa_orm.relationship = MagicMock()
    mock_sa_orm.validates = mock_validates
    mock_sa_orm.sessionmaker = MagicMock()
    mock_sa_orm.Session = MagicMock()

    class MockBase:
        def __init__(self, **kwargs):
            validators = {}
            for attr in dir(self.__class__):
                fn = getattr(self.__class__, attr)
                if hasattr(fn, "_sa_validates"):
                    for name in fn._sa_validates:
                        validators[name] = getattr(self, attr)

            for k, v in kwargs.items():
                if k in validators:
                    v = validators[k](k, v)
                setattr(self, k, v)
            self._sa_initialized = True

        def __setattr__(self, name, value):
            if getattr(self, "_sa_initialized", False):
                for attr in dir(self.__class__):
                    fn = getattr(self.__class__, attr)
                    if hasattr(fn, "_sa_validates") and name in fn._sa_validates:
                        value = getattr(self, attr)(name, value)
            super().__setattr__(name, value)

    mock_sa_orm.DeclarativeBase = MockBase
    mock_sa.orm = mock_sa_orm

    mock_sa_dialects = _make_mock_module("sqlalchemy.dialects")
    mock_sa_pg = _make_mock_module("sqlalchemy.dialects.postgresql")
    mock_sa_pg.UUID = MagicMock()
    mock_sa_dialects.postgresql = mock_sa_pg
    mock_sa.dialects = mock_sa_dialects

if _need_mock("geoalchemy2"):
    mock_geo = _make_mock_module("geoalchemy2")
    mock_geo.Geometry = MagicMock()

if "app.db.postgres" not in sys.modules:
    mock_app_db_pg = _make_mock_module("app.db.postgres")
    mock_app_db_pg.Base = MockBase
    mock_app_db_pg.engine = MagicMock()
    mock_app_db_pg.SessionLocal = MagicMock()
    mock_app_db_pg.get_db = MagicMock()

if "app.db.redis" not in sys.modules:
    _make_mock_module("redis")
    mock_redis_mod = _make_mock_module("app.db.redis")
    mock_redis_mod.get_redis_client = MagicMock()

if "app.security" not in sys.modules:
    mock_sec = _make_mock_module("app.security")
    mock_sec.enforce_rate_limit = MagicMock()
    mock_sec.require_operator = MagicMock()
    mock_sec.require_viewer = MagicMock()
    mock_sec.require_admin = MagicMock()

from app.api.scenarios import (
    ScenarioCreate,
    UpgradeNodeModification,
    create_scenario,
)
from app.simulation.runner import apply_scenario_modifications
from fastapi import HTTPException


def test_upgrade_node_modification_capacity():
    node_id = uuid.uuid4()
    mod = UpgradeNodeModification(type="upgrade_node", node_id=node_id, capacity=160.0)
    assert mod.type == "upgrade_node"
    assert mod.node_id == node_id
    assert mod.capacity == 160.0
    dumped = mod.model_dump(exclude_none=True)
    assert dumped["type"] == "upgrade_node"
    assert dumped["capacity"] == 160.0


def test_upgrade_node_modification_multiplier_and_threshold():
    node_id = uuid.uuid4()
    mod = UpgradeNodeModification(
        type="upgrade_node",
        node_id=node_id,
        capacity_multiplier=2.0,
        failure_threshold=1.5,
    )
    assert mod.capacity_multiplier == 2.0
    assert mod.failure_threshold == 1.5


def test_apply_scenario_modifications_upgrade_capacity():
    G = nx.DiGraph()
    G.add_node("n1", capacity=100.0, failure_threshold=1.0)
    G.add_node("n2", capacity=50.0, failure_threshold=1.0)

    modifications = [{"type": "upgrade_node", "node_id": "n1", "capacity": 200.0}]
    G_mod = apply_scenario_modifications(G, modifications)

    # Immutability
    assert G.nodes["n1"]["capacity"] == 100.0
    # Modified graph has updated capacity
    assert G_mod.nodes["n1"]["capacity"] == 200.0
    assert G_mod.nodes["n2"]["capacity"] == 50.0


def test_apply_scenario_modifications_upgrade_multiplier():
    G = nx.DiGraph()
    G.add_node("n1", capacity=80.0, failure_threshold=1.0)

    modifications = [{"type": "upgrade_node", "node_id": "n1", "capacity_multiplier": 1.5}]
    G_mod = apply_scenario_modifications(G, modifications)

    assert abs(G_mod.nodes["n1"]["capacity"] - 120.0) < 1e-6
    assert G.nodes["n1"]["capacity"] == 80.0


def test_apply_scenario_modifications_upgrade_threshold():
    G = nx.DiGraph()
    G.add_node("n1", capacity=100.0, failure_threshold=1.0)

    modifications = [{"type": "upgrade_node", "node_id": "n1", "failure_threshold": 1.8}]
    G_mod = apply_scenario_modifications(G, modifications)

    assert G_mod.nodes["n1"]["failure_threshold"] == 1.8


def test_apply_scenario_modifications_unknown_node_raises():
    G = nx.DiGraph()
    G.add_node("n1", capacity=100.0)

    modifications = [{"type": "upgrade_node", "node_id": "nonexistent", "capacity": 200.0}]
    with pytest.raises(ValueError, match="unknown node"):
        apply_scenario_modifications(G, modifications)


def test_apply_scenario_modifications_unsupported_type_raises():
    G = nx.DiGraph()
    G.add_node("n1", capacity=100.0)

    modifications = [{"type": "invalid_type", "node_id": "n1"}]
    with pytest.raises(ValueError, match="unsupported scenario modification"):
        apply_scenario_modifications(G, modifications)


def test_create_scenario_endpoint_validation():
    network_id = uuid.uuid4()
    node_a = uuid.uuid4()
    node_b = uuid.uuid4()
    outside_node = uuid.uuid4()

    # Mock DB session
    db = MagicMock()
    mock_network = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = mock_network
    db.query.return_value.filter.return_value.all.return_value = [(node_a,), (node_b,)]

    # 1. Valid upgrade scenario referencing known node
    req_valid = ScenarioCreate(
        network_id=network_id,
        name="Test Upgrade Scenario",
        description="Testing upgrade_node validation",
        modifications=[UpgradeNodeModification(type="upgrade_node", node_id=node_a, capacity=160.0)],
        initial_failures=[node_b],
    )
    res = create_scenario(req=req_valid, db=db)
    assert res.name == "Test Upgrade Scenario"
    assert db.add.called
    assert db.commit.called

    # 2. Invalid scenario referencing node outside network
    req_invalid = ScenarioCreate(
        network_id=network_id,
        name="Invalid Scenario",
        description="References outside node",
        modifications=[UpgradeNodeModification(type="upgrade_node", node_id=outside_node, capacity=160.0)],
        initial_failures=[node_a],
    )
    with pytest.raises(HTTPException) as exc_info:
        create_scenario(req=req_invalid, db=db)
    assert exc_info.value.status_code == 422
    assert "outside this network" in exc_info.value.detail
