from dataclasses import dataclass


@dataclass
class ModelInfo:
    id: str
    name: str
    provider: str
    tag: str  # 快速 / 均衡 / 推理 / 强力


AVAILABLE_MODELS: list[ModelInfo] = [
    # DeepSeek
    ModelInfo("deepseek-v3", "DeepSeek V3", "DeepSeek", "快速"),
    ModelInfo("deepseek-v3.1", "DeepSeek V3.1", "DeepSeek", "均衡"),
    ModelInfo("deepseek-r1", "DeepSeek R1", "DeepSeek", "推理"),

    # OpenAI
    ModelInfo("gpt-5-nano", "GPT-5 Nano", "OpenAI", "快速"),
    ModelInfo("gpt-5", "GPT-5", "OpenAI", "强力"),

    # Anthropic
    ModelInfo("claude-sonnet-4-5-20250929", "Claude Sonnet 4.5", "Anthropic", "均衡"),
    ModelInfo("claude-haiku-4-5-20251001", "Claude Haiku 4.5", "Anthropic", "快速"),

    # Google
    ModelInfo("gemini-2.5-flash", "Gemini 2.5 Flash", "Google", "快速"),

    # Qwen / Kimi
    ModelInfo("kimi-k2", "Kimi K2", "Kimi", "均衡"),
]

DEFAULT_MODEL = "deepseek-v3"


def get_models_dict() -> list[dict]:
    return [
        {"id": m.id, "name": m.name, "provider": m.provider, "tag": m.tag}
        for m in AVAILABLE_MODELS
    ]
