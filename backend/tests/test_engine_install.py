"""测试引擎安装的变体选择：按 CPU 自动挑最快、找不到信息时回退最兼容。"""

from app import engine_install as ei

# 模拟官方发布包里 Windows 平台的全部变体可执行文件名
WIN_NAMES = [
    "Pikafish/pikafish-vnni512.exe",
    "Pikafish/pikafish-avx512.exe",
    "Pikafish/pikafish-bmi2.exe",
    "Pikafish/pikafish-avx2.exe",
    "Pikafish/pikafish-sse41-popcnt.exe",
    "Pikafish/pikafish-ssse3.exe",
    "Pikafish/pikafish.nnue",
]


def test_candidates_filter_windows_executables():
    cands = ei._candidates(WIN_NAMES, "windows")
    bases = {ei._basename(c) for c in cands}
    assert "pikafish.nnue" not in bases  # 权重不是可执行候选
    assert "pikafish-avx2.exe" in bases
    assert "pikafish-sse41-popcnt.exe" in bases


def test_auto_picks_fastest_supported(monkeypatch):
    # CPU 支持到 avx2/bmi2，但不支持 avx512 → 自动应挑 bmi2（比 avx2 靠前）
    monkeypatch.setattr(
        ei, "_cpu_flags", lambda: {"sse2", "ssse3", "sse4_1", "popcnt", "avx2", "bmi2"}
    )
    cands = ei._candidates(WIN_NAMES, "windows")
    chosen = ei._choose(cands, None, "windows", "AMD64")
    assert ei._basename(chosen) == "pikafish-bmi2.exe"


def test_auto_skips_unsupported_avx512(monkeypatch):
    # 仅支持到 sse4.1/popcnt → 不能挑 avx2/avx512，应落到 sse41-popcnt
    monkeypatch.setattr(
        ei, "_cpu_flags", lambda: {"sse2", "ssse3", "sse4_1", "popcnt"}
    )
    cands = ei._candidates(WIN_NAMES, "windows")
    chosen = ei._choose(cands, None, "windows", "x86_64")
    assert ei._basename(chosen) == "pikafish-sse41-popcnt.exe"


def test_falls_back_to_compat_when_cpu_unknown(monkeypatch):
    # 探测不到 CPU flag → 回退「最兼容优先」，挑 sse41-popcnt（_COMPAT_ASC 最靠前的存在项）
    monkeypatch.setattr(ei, "_cpu_flags", lambda: None)
    cands = ei._candidates(WIN_NAMES, "windows")
    chosen = ei._choose(cands, None, "windows", "x86_64")
    assert ei._basename(chosen) == "pikafish-sse41-popcnt.exe"


def test_explicit_variant_overrides_auto(monkeypatch):
    monkeypatch.setattr(ei, "_cpu_flags", lambda: {"avx2", "bmi2", "sse4_1", "popcnt"})
    cands = ei._candidates(WIN_NAMES, "windows")
    chosen = ei._choose(cands, "ssse3", "windows", "x86_64")
    assert ei._basename(chosen) == "pikafish-ssse3.exe"


def test_explicit_missing_variant_returns_none():
    cands = ei._candidates(WIN_NAMES, "windows")
    assert ei._choose(cands, "avx10", "windows", "x86_64") is None


def test_rank_full_order_for_self_test_fallback(monkeypatch):
    # 自检回退用的完整排序：最快在前，更兼容在后
    monkeypatch.setattr(
        ei, "_cpu_flags", lambda: {"sse2", "ssse3", "sse4_1", "popcnt", "avx2", "bmi2"}
    )
    cands = ei._candidates(WIN_NAMES, "windows")
    ranked = [ei._basename(c) for c in ei._rank_candidates(cands, "windows", "x86_64")]
    assert ranked[0] == "pikafish-bmi2.exe"
    # avx512/vnni512 本机不支持，应排在 bmi2/avx2 之后（作为兜底而非优先）
    assert ranked.index("pikafish-bmi2.exe") < ranked.index("pikafish-avx512.exe")


def test_variant_info_tiers(monkeypatch):
    # 本机支持到 bmi2 → bmi2 推荐；更靠前(vnni512/avx512)标 faster；其余 compatible
    monkeypatch.setattr(
        ei, "_cpu_flags", lambda: {"sse2", "ssse3", "sse4_1", "popcnt", "avx2", "bmi2"}
    )
    variants = [ei._basename(n) for n in WIN_NAMES if not n.endswith(".nnue")]
    info = ei._variant_info(variants, "windows", "x86_64")
    tier = {d["name"]: d["tier"] for d in info}
    assert tier["pikafish-bmi2.exe"] == "recommended"
    assert tier["pikafish-vnni512.exe"] == "faster"
    assert tier["pikafish-avx512.exe"] == "faster"
    assert tier["pikafish-avx2.exe"] == "compatible"
    assert tier["pikafish-sse41-popcnt.exe"] == "compatible"
    # 每个变体都带人类可读说明
    assert all(d["label"] for d in info)
    # 输出按性能从高到低（vnni512 在 bmi2 之前，bmi2 在 sse41 之前）
    order = [d["name"] for d in info]
    assert order.index("pikafish-vnni512.exe") < order.index("pikafish-bmi2.exe")
    assert order.index("pikafish-bmi2.exe") < order.index("pikafish-sse41-popcnt.exe")


def test_variant_info_unknown_cpu(monkeypatch):
    monkeypatch.setattr(ei, "_cpu_flags", lambda: None)
    variants = [ei._basename(n) for n in WIN_NAMES if not n.endswith(".nnue")]
    info = ei._variant_info(variants, "windows", "x86_64")
    # 探测不到 CPU → 不标推荐，全部为 unknown
    assert {d["tier"] for d in info} == {"unknown"}


def test_expected_variants_before_download(monkeypatch):
    # 尚未下载时也应给出本机平台预期变体清单，供前端首屏展示三档
    monkeypatch.setattr(
        ei, "_cpu_flags", lambda: {"sse2", "ssse3", "sse4_1", "popcnt", "avx2", "bmi2"}
    )
    ev = ei.expected_variants("windows", "AMD64")
    assert "pikafish-bmi2.exe" in ev
    info = ei._variant_info(ev, "windows", "AMD64")
    tier = {d["name"]: d["tier"] for d in info}
    assert tier["pikafish-bmi2.exe"] == "recommended"
    assert tier["pikafish-vnni512.exe"] == "faster"


def test_expected_variants_macos_arch_filtered():
    # macOS 按架构只给相关变体，不混 x86/ARM
    assert ei.expected_variants("macos", "arm64") == ["pikafish-apple-silicon"]
    assert ei.expected_variants("macos", "x86_64") == ["pikafish-x86-64"]


def test_arm_macos_prefers_apple_silicon():
    names = [
        "Pikafish/pikafish-apple-silicon",
        "Pikafish/pikafish-armv8",
        "Pikafish/pikafish.nnue",
    ]
    cands = ei._candidates(names, "macos")
    chosen = ei._choose(cands, None, "macos", "arm64")
    assert ei._basename(chosen) == "pikafish-apple-silicon"
