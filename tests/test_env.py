import os

from drafty_ai.client import configured
from drafty_api.settings import load_local_env


def test_dotenv_does_not_replace_an_exported_key(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("MODEL_API_KEY=from-file\n", encoding="utf-8")
    monkeypatch.setenv("MODEL_API_KEY", "from-shell")
    load_local_env(env_file)
    assert os.environ["MODEL_API_KEY"] == "from-shell"
    assert configured() is True


def test_dotenv_fills_a_key_the_shell_did_not_export(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("MODEL_API_KEY=from-file\n", encoding="utf-8")
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    load_local_env(env_file)
    assert os.environ["MODEL_API_KEY"] == "from-file"
    assert configured() is True
