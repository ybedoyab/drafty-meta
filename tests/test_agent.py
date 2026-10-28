import pytest

from drafty_ai.agent import execute_tool, interpret
from drafty_engineering.openscad_export import to_openscad
from drafty_engineering.spec import cantilever_benchmark_spec


def test_unknown_tool_is_not_executed():
    result = execute_tool("os_system", {"command": "echo unsafe"})
    assert result["action"] == "rejected"
    assert result["spec"] is None


def test_propose_design_uses_the_typed_spec():
    result = execute_tool("propose_design", cantilever_benchmark_spec().model_dump())
    assert result["action"] == "propose"
    assert result["spec"]["kind"] == "cantilever_beam"


def test_image_without_numbers_does_not_call_the_model(monkeypatch):
    def fail(*_args, **_kwargs):
        raise AssertionError("The model API should not be called.")

    monkeypatch.setattr("drafty_ai.agent.chat_completion", fail)
    result = interpret("identify this part", "data:image/png;base64,aaaa")
    assert result["action"] == "clarify"
    assert result["spec"] is None


def test_openscad_export_is_text_only():
    text = to_openscad(cantilever_benchmark_spec())
    assert "cube" in text
    assert "300" in text
    assert "Finite element analysis uses the STEP solid" in text


@pytest.mark.parametrize("name", ["os.system", "subprocess", "exec"])
def test_allowlist_does_not_include_code_execution(name: str):
    assert execute_tool(name, {})["action"] == "rejected"
