"""三种通用 LLM 接口格式的请求与响应适配测试。"""
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import llm
from app.llm import _chat_raw, _normalize_usage, _request_parts, _response_text
from app.settings import (
    PROTOCOL_ANTHROPIC,
    PROTOCOL_OPENAI_CHAT,
    PROTOCOL_OPENAI_RESPONSES,
)


def _cfg(protocol: str, base_url: str):
    return SimpleNamespace(
        protocol=protocol, base_url=base_url, api_key="sk-test", model="test-model", active=True,
        thinking_enabled=True, reasoning_effort="high",
    )


def test_openai_chat_completions_adapter():
    url, headers, body = _request_parts(
        _cfg(PROTOCOL_OPENAI_CHAT, "https://example.com/v1"), "你好", 123,
    )
    assert url == "https://example.com/v1/chat/completions"
    assert headers["Authorization"] == "Bearer sk-test"
    assert body == {
        "model": "test-model",
        "messages": [{"role": "user", "content": "你好"}],
        "max_tokens": 123,
        "thinking": {"type": "enabled"},
        "reasoning_effort": "high",
    }
    text, reasoning, finish = _response_text(PROTOCOL_OPENAI_CHAT, {
        "choices": [{"message": {"content": [{"type": "text", "text": "  回答  "}],
                                  "reasoning_content": "思考"},
                     "finish_reason": "stop"}],
    })
    assert (text, reasoning, finish) == ("回答", "思考", "stop")


def test_openai_responses_adapter():
    url, headers, body = _request_parts(
        _cfg(PROTOCOL_OPENAI_RESPONSES, "https://example.com/v1/responses"), "你好", 456,
    )
    assert url == "https://example.com/v1/responses"
    assert headers["Authorization"] == "Bearer sk-test"
    assert body == {"model": "test-model", "input": "你好", "max_output_tokens": 456}
    text, _, status = _response_text(PROTOCOL_OPENAI_RESPONSES, {
        "status": "completed",
        "output": [{"content": [
            {"type": "output_text", "text": "第一段"},
            {"type": "output_text", "text": "第二段"},
        ]}],
    })
    assert text == "第一段第二段"
    assert status == "completed"


def test_anthropic_messages_adapter_and_usage():
    url, headers, body = _request_parts(
        _cfg(PROTOCOL_ANTHROPIC, "https://example.com/v1"), "你好", 789,
    )
    assert url == "https://example.com/v1/messages"
    assert headers["x-api-key"] == "sk-test"
    assert headers["anthropic-version"] == "2023-06-01"
    assert body == {
        "model": "test-model",
        "messages": [{"role": "user", "content": "你好"}],
        "max_tokens": 789,
        "reasoning": {"effort": "high"},
        "output_config": {"effort": "high"},
    }
    text, _, finish = _response_text(PROTOCOL_ANTHROPIC, {
        "content": [{"type": "thinking", "thinking": "..."},
                    {"type": "text", "text": "回答"}],
        "stop_reason": "end_turn",
    })
    assert text == "回答"
    assert finish == "end_turn"
    assert _normalize_usage(PROTOCOL_ANTHROPIC, {
        "input_tokens": 10, "output_tokens": 3, "cache_read_input_tokens": 4,
    }) == {
        "prompt_tokens": 10,
        "completion_tokens": 3,
        "total_tokens": 13,
        "prompt_tokens_details": {"cached_tokens": 4},
    }


def test_chat_reserves_budget_for_reasoning_content(monkeypatch):
    captured = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [{
                    "message": {"reasoning_content": "简短思考", "content": "ok"},
                    "finish_reason": "stop",
                }],
                "usage": {},
            }

    class Client:
        def __init__(self, timeout):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def post(self, url, headers, json):
            captured.update(url=url, headers=headers, json=json)
            return Response()

    monkeypatch.setattr(llm.httpx, "Client", Client)
    monkeypatch.setattr(llm, "_record_call", lambda *args, **kwargs: None)
    text, error = _chat_raw(
        "回复 ok", max_tokens=10, timeout=15,
        config=_cfg(PROTOCOL_OPENAI_CHAT, "https://example.com/v1"),
    )
    assert (text, error) == ("ok", "")
    assert captured["json"]["max_tokens"] == 5010
    assert captured["timeout"] == 75


def test_reasoning_switch_and_effort_mapping():
    expected = {"low": "low", "medium": "high", "high": "high", "xhigh": "high", "max": "max"}
    for requested, mapped in expected.items():
        cfg = _cfg(PROTOCOL_OPENAI_CHAT, "https://example.com/v1")
        cfg.reasoning_effort = requested
        _, _, body = _request_parts(cfg, "你好", 100)
        assert body["thinking"] == {"type": "enabled"}
        assert body["reasoning_effort"] == mapped

    chat_cfg = _cfg(PROTOCOL_OPENAI_CHAT, "https://example.com/v1")
    chat_cfg.thinking_enabled = False
    _, _, chat_body = _request_parts(chat_cfg, "你好", 100)
    assert chat_body["thinking"] == {"type": "disabled"}
    assert "reasoning_effort" not in chat_body

    anthropic_cfg = _cfg(PROTOCOL_ANTHROPIC, "https://example.com/v1")
    anthropic_cfg.thinking_enabled = False
    _, _, anthropic_body = _request_parts(anthropic_cfg, "你好", 100)
    assert anthropic_body["reasoning"] == {"effort": "none"}
    assert "output_config" not in anthropic_body
