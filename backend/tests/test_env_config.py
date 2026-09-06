"""测试 .env 加载器(app/core/env.py)。"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import parse_env_text  # noqa: E402


def test_parse_basic_and_comments():
    text = "\n".join(
        [
            "# 整行注释",
            "HOST=0.0.0.0",
            "export PORT=9000",
            "SECRET_KEY = \"abc 123 # 不是注释\"",
            "LLM_BASE_URL='https://example.com/v1'",
            "CORS_ORIGINS=http://a.com, http://b.com  # 行内注释",
            "EMPTY=",
            "没有等号的行",
            "1INVALID=skip",
            "A B=skip",
        ]
    )
    assert parse_env_text(text) == {
        "HOST": "0.0.0.0",
        "PORT": "9000",
        "SECRET_KEY": "abc 123 # 不是注释",
        "LLM_BASE_URL": "https://example.com/v1",
        "CORS_ORIGINS": "http://a.com, http://b.com",
        "EMPTY": "",
    }


def test_load_from_explicit_file(tmp_path, monkeypatch):
    """ENV_FILE 指定文件可加载,且不覆盖已存在的环境变量。"""
    env_file = tmp_path / "test.env"
    env_file.write_text(
        "ENV_TEST_FROM_FILE=1\nENV_TEST_EXISTING=from_file\n", encoding="utf-8"
    )
    monkeypatch.setenv("ENV_FILE", str(env_file))
    monkeypatch.setenv("ENV_TEST_EXISTING", "from_env")  # 环境变量优先

    from app.core import env as env_mod

    try:
        assert env_mod.load_dotenv(force=True) == env_file
        assert os.environ["ENV_TEST_FROM_FILE"] == "1"
        assert os.environ["ENV_TEST_EXISTING"] == "from_env"
    finally:
        # 加载器直接写入 os.environ,monkeypatch 追踪不到,手动清理
        os.environ.pop("ENV_TEST_FROM_FILE", None)
