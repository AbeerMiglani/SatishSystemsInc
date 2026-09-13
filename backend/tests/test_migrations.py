"""Guards on the Alembic migration graph.

A divergent branch previously left two heads in the history, which made
``alembic upgrade head`` fail outright. Because docker-compose's ``migrator``
service runs exactly that command and the ``seeder`` gates on it, the whole
cold-start path was broken. These tests fail fast if a second head is ever
reintroduced.
"""

from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _script_directory() -> ScriptDirectory:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return ScriptDirectory.from_config(config)


def test_migration_graph_has_exactly_one_head():
    """``alembic upgrade head`` is only unambiguous with a single head."""
    heads = _script_directory().get_heads()
    assert len(heads) == 1, (
        f"Expected exactly 1 Alembic head, found {len(heads)}: {sorted(heads)}. "
        "Multiple heads make 'alembic upgrade head' fail and break the "
        "docker-compose migrator/seeder cold start. Resolve the branch with a "
        "merge revision or by re-parenting the divergent migration."
    )


def test_migration_chain_is_linear_and_reachable():
    """Every revision must be walkable from base to the single head."""
    script = _script_directory()
    head = script.get_heads()[0]

    walked = [rev.revision for rev in script.walk_revisions("base", head)]
    on_disk = [rev.revision for rev in script.walk_revisions()]

    assert sorted(walked) == sorted(on_disk), (
        "Some migration files are not reachable from base -> head: "
        f"{sorted(set(on_disk) - set(walked))}"
    )

    # A linear chain means each revision has at most one parent.
    for rev in script.walk_revisions("base", head):
        assert len(rev.down_revision or ()) <= 1 or isinstance(rev.down_revision, str), (
            f"Revision {rev.revision} has multiple parents: {rev.down_revision}"
        )
