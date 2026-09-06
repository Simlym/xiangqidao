from pathlib import Path

from app.core import migrations


def test_alembic_paths_are_resolved_from_backend_root(monkeypatch, tmp_path):
    """迁移配置不应随进程启动目录或模块重构位置而变化。"""
    monkeypatch.chdir(tmp_path)

    config = migrations._config()

    backend_dir = Path(__file__).resolve().parents[1]
    assert Path(config.config_file_name).resolve() == backend_dir / "alembic.ini"
    assert Path(config.get_main_option("script_location")).resolve() == backend_dir / "migrations"
    assert (Path(config.get_main_option("script_location")) / "env.py").is_file()
