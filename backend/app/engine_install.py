"""Pikafish 引擎的一键下载 / 更新（供管理后台使用）。

设计要点：
- 仅从官方仓库 ``official-pikafish/Pikafish`` 的最新 Release 拉取，不接受任意 URL；
- 按操作系统从发布包中挑选可执行文件，默认选「最兼容」的变体，降低因 CPU 指令集
  不支持而崩溃的概率，管理员也可手动指定更快的变体；
- 连同 NNUE 权重一起装入受管目录（默认 ``./data/engine``），装好后由 engine.find_engine
  自动发现并复用，无需修改 PATH、也无需重启进程；
- 下载在后台线程进行，进度 / 状态通过 ``status()`` 暴露给前端轮询。
"""

from __future__ import annotations

import datetime
import json
import os
import platform
import re
import shutil
import stat
import tempfile
import threading
import urllib.request
import zipfile

REPO = "official-pikafish/Pikafish"
_LATEST_API = f"https://api.github.com/repos/{REPO}/releases/latest"
_UA = {"User-Agent": "xiangqidao-engine-installer"}

# 变体兼容性从高到低；作为「自动挑最兼容」与自检回退的兜底排序，
# 即便慢一点也优先保证能跑起来。
_COMPAT_ASC = [
    "sse41-popcnt", "sse41", "ssse3", "popcnt", "sse2",
    "apple-silicon", "armv8", "armv7", "modern", "x86-64",
    "avx2", "bmi2", "avxvnni", "vnni256", "avx512", "vnni512",
]

# x86-64 变体「性能从高到低」：每个变体 → 它要求 CPU 支持的指令集 flag 集合。
# 自动模式下从上往下挑「本机 CPU 全部支持 且 发布包内存在」的第一个（最快）变体。
# flag 名取 py-cpuinfo / /proc/cpuinfo 的小写形式（avx512 用其基础子集 avx512f）。
_X86_PERF_DESC = [
    ("vnni512", {"avx512f", "avx512vnni"}),
    ("avx512", {"avx512f"}),
    ("vnni256", {"avx2", "avx512vnni"}),
    ("avxvnni", {"avx2", "avxvnni"}),
    ("bmi2", {"avx2", "bmi2"}),
    ("avx2", {"avx2"}),
    ("sse41-popcnt", {"sse4_1", "popcnt"}),
    ("sse41", {"sse4_1"}),
    ("ssse3", {"ssse3"}),
    ("popcnt", {"popcnt"}),
    ("sse2", {"sse2"}),
]

# Apple Silicon / ARM：按 machine() 直接给出优选变体顺序（无需指令集探测）。
_ARM_PERF_DESC = {
    "macos": ["apple-silicon", "armv8"],
    "linux": ["armv8", "armv7", "modern"],
}

# 官方发布包各平台「预期会提供」的变体名（用于尚未下载时也能展示变体指南）。
# 实际下载后会以包内真实文件名覆盖；这里只为首屏不空着。
_EXPECTED_VARIANTS = {
    "windows": [
        "pikafish-vnni512.exe", "pikafish-avx512.exe", "pikafish-bmi2.exe",
        "pikafish-avx2.exe", "pikafish-sse41-popcnt.exe", "pikafish-ssse3.exe",
    ],
    "linux": [
        "pikafish-vnni512", "pikafish-avx512", "pikafish-bmi2",
        "pikafish-avx2", "pikafish-sse41-popcnt", "pikafish-ssse3",
    ],
    "macos": ["pikafish-apple-silicon", "pikafish-x86-64"],
}


def expected_variants(os_name: str, arch: str) -> list[str]:
    """本机平台预期可用的变体名（尚未下载时给前端展示用）。

    macOS 上按架构只给相关的一种，避免把 x86 / ARM 变体混在一起误导用户。
    """
    arch_l = (arch or "").lower()
    if os_name == "macos":
        if arch_l in ("arm64", "aarch64") or arch_l.startswith("arm"):
            return ["pikafish-apple-silicon"]
        return ["pikafish-x86-64"]
    return list(_EXPECTED_VARIANTS.get(os_name, []))

# 变体的中文说明，给前端做人类可读提示用。键是变体名子串，匹配文件名即可。
# 顺序大致从快到慢，前端展示「性能从高到低」表时可参考。
_VARIANT_LABELS = [
    ("vnni512", "最快，需 AVX-512 VNNI（较新服务器/高端桌面 CPU）"),
    ("avx512", "很快，需 AVX-512（较新 Intel/部分 AMD）"),
    ("vnni256", "很快，需 AVX2 + VNNI"),
    ("avxvnni", "很快，需 AVX2 + AVX-VNNI"),
    ("bmi2", "快，需 AVX2 + BMI2（2013 年后多数桌面 CPU）"),
    ("avx2", "快，需 AVX2（2013 年后多数 CPU）"),
    ("apple-silicon", "Apple Silicon（M 系列）原生"),
    ("armv8", "ARMv8 / 64 位 ARM"),
    ("armv7", "ARMv7 / 32 位 ARM"),
    ("sse41-popcnt", "通用，需 SSE4.1 + POPCNT（2008 年后绝大多数 CPU）"),
    ("sse41", "通用，需 SSE4.1"),
    ("ssse3", "兼容，需 SSSE3（较老 CPU）"),
    ("popcnt", "兼容，需 POPCNT"),
    ("sse2", "最兼容，仅需 SSE2（很老的 CPU 也能跑）"),
    ("modern", "通用现代版"),
    ("x86-64", "最通用 x86-64 基线"),
]


def _variant_label(name: str) -> str:
    low = name.lower()
    for kw, desc in _VARIANT_LABELS:
        if kw in low:
            return desc
    return ""


def _variant_info(variants: list[str], os_name: str, arch: str) -> list[dict]:
    """把发布包内可用变体标注为「推荐 / 更快但本机可能不支持 / 更兼容」三档，
    供前端清晰展示，避免用户面对一串裸变体名无从判断。

    分档依据本机 CPU 优选顺序 _auto_variant_order：
    - 推荐：优选顺序里第一个、且包内存在的变体；
    - 更快：在「性能表」中比推荐变体更靠前者（本机 CPU 通常不支持，装了可能崩）；
    - 更兼容：比推荐变体更靠后者（更稳但更慢）。
    探测不到 CPU 时全部按「最兼容优先」给序，不标推荐。
    """
    pref = _auto_variant_order(os_name, arch)
    recommended = pref[0] if pref else None

    # 用「性能从高到低」基准给每个变体一个名次，便于判断更快/更兼容
    arch_l = (arch or "").lower()
    if arch_l.startswith("arm") or arch_l in ("arm64", "aarch64"):
        perf_order = _ARM_PERF_DESC.get(os_name, ["armv8", "armv7"])
    else:
        perf_order = [name for name, _ in _X86_PERF_DESC]

    def perf_rank(v: str) -> int:
        low = v.lower()
        for i, kw in enumerate(perf_order):
            if kw in low:
                return i
        return len(perf_order)

    rec_rank = perf_rank(recommended) if recommended else None
    out: list[dict] = []
    for v in variants:
        low = v.lower()
        is_rec = recommended is not None and recommended in low
        if rec_rank is None:
            tier = "unknown"
        elif is_rec:
            tier = "recommended"
        elif perf_rank(v) < rec_rank:
            tier = "faster"        # 更快，但本机 CPU 可能不支持
        else:
            tier = "compatible"    # 更兼容、更稳，但更慢
        out.append({"name": v, "label": _variant_label(v), "tier": tier})
    # 按性能从高到低排，前端直接照单渲染
    out.sort(key=lambda d: perf_rank(d["name"]))
    return out


# 最近一次 CPU 探测失败的原因，供 status() 回传前端定位问题（缺依赖/异常/无 flag）。
_cpu_detect_note: str = ""

# CPU 指令集 flag 在进程生命周期内不变，但 py-cpuinfo.get_cpu_info() 在 Windows 上
# 每次要起子进程探测、耗时约 1~2 秒。status() 一次调用会多次用到，故缓存首次结果，
# 避免管理后台轮询时每次都阻塞数秒。_FLAGS_UNSET 区分「尚未探测」与「探测过但失败(None)」。
_FLAGS_UNSET = object()
_cpu_flags_cache: object = _FLAGS_UNSET


def _cpu_flags() -> set[str] | None:
    """探测本机 CPU 指令集 flag（小写），结果按进程缓存。

    优先用可选依赖 py-cpuinfo（跨平台、含 Windows）；不可用时尝试 Linux 的
    /proc/cpuinfo；都拿不到则返回 None，调用方据此回退到「最兼容」策略。
    失败原因记入 _cpu_detect_note，便于在管理后台提示用户。
    """
    global _cpu_flags_cache
    if _cpu_flags_cache is not _FLAGS_UNSET:
        return _cpu_flags_cache  # type: ignore[return-value]
    _cpu_flags_cache = _detect_cpu_flags()
    return _cpu_flags_cache  # type: ignore[return-value]


def _detect_cpu_flags() -> set[str] | None:
    global _cpu_detect_note
    try:
        import cpuinfo  # 可选依赖，缺失则走下方回退
    except ImportError:
        _cpu_detect_note = "缺少依赖 py-cpuinfo（请 pip install py-cpuinfo 后重启后端）"
        cpuinfo = None
    except Exception as e:  # noqa: BLE001
        _cpu_detect_note = f"导入 py-cpuinfo 失败：{e}"
        cpuinfo = None

    if cpuinfo is not None:
        try:
            info = cpuinfo.get_cpu_info()
            flags = info.get("flags")
            if flags:
                _cpu_detect_note = ""
                return {str(f).lower() for f in flags}
            _cpu_detect_note = "py-cpuinfo 未返回 CPU flags"
        except Exception as e:  # noqa: BLE001
            _cpu_detect_note = f"py-cpuinfo 探测异常：{e}"

    try:
        with open("/proc/cpuinfo", encoding="utf-8") as f:
            for line in f:
                if line.lower().startswith("flags") and ":" in line:
                    _cpu_detect_note = ""
                    return {t.lower() for t in line.split(":", 1)[1].split()}
    except OSError:
        pass
    return None


def warm_cpu_cache() -> None:
    """后台预热 CPU flag 探测缓存。py-cpuinfo 首探约 1~2 秒，放到启动时的后台线程里跑，
    避免管理后台第一次拉取引擎状态时干等数秒。"""
    threading.Thread(target=_cpu_flags, daemon=True).start()


def _auto_variant_order(os_name: str, arch: str) -> list[str]:
    """返回自动模式下「从最快到最兼容」的变体偏好顺序。

    - x86_64：按本机 CPU flag 过滤，挑得动的最快变体在前，并附上更兼容的兜底；
    - ARM / Apple Silicon：按平台给定顺序；
    - 探测不到 CPU 信息：返回空列表，由 _choose 回退到 _COMPAT_ASC 兜底。
    """
    arch = (arch or "").lower()
    if arch in ("x86_64", "amd64", "x64", "i386", "i686", "x86"):
        flags = _cpu_flags()
        if flags is None:
            return []
        order = [name for name, need in _X86_PERF_DESC if need <= flags]
        # 保险起见把最兼容的几个变体追加到末尾作为回退（去重保序）
        for name in ("sse41-popcnt", "ssse3", "sse2"):
            if name not in order:
                order.append(name)
        return order
    if arch in ("arm64", "aarch64", "armv8", "armv8l"):
        return _ARM_PERF_DESC.get(os_name, ["armv8"])
    if arch.startswith("arm"):
        return _ARM_PERF_DESC.get(os_name, ["armv7"])
    return []

# 发布包内用于区分平台的目录 / 文件名关键字
_OS_TOKENS = {
    "windows": ("windows", "win"),
    "macos": ("macos", "darwin", "mac", "apple"),
    "linux": ("linux", "ubuntu"),
}
_SKIP_EXT = (".nnue", ".txt", ".md", ".html", ".pdf", ".ini", ".json", ".bin", ".zip")

_lock = threading.Lock()
_status: dict = {
    "state": "idle",      # idle / downloading / extracting / verifying / done / error
    "message": "",
    "downloaded": 0,      # 已下载字节
    "total": 0,           # 总字节（部分服务器不提供时为 0）
    "error": "",
    "variant": None,      # 已选用的变体
    "variants": [],       # 最近一次下载包内、适配本机 OS 的可用变体
}


# ── 路径与状态 ──────────────────────────────────────────────────

def engine_dir() -> str:
    return os.environ.get("XQ_ENGINE_DIR", os.path.join("data", "engine"))


def binary_name() -> str:
    return "pikafish.exe" if os.name == "nt" else "pikafish"


def binary_path() -> str:
    return os.path.abspath(os.path.join(engine_dir(), binary_name()))


def nnue_path() -> str:
    return os.path.abspath(os.path.join(engine_dir(), "pikafish.nnue"))


def _meta_path() -> str:
    return os.path.abspath(os.path.join(engine_dir(), "meta.json"))


def is_installed() -> bool:
    return os.path.isfile(binary_path()) and os.path.isfile(nnue_path())


def read_meta() -> dict | None:
    try:
        with open(_meta_path(), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def detect_os() -> str:
    s = platform.system().lower()
    if s.startswith("win"):
        return "windows"
    if s == "darwin":
        return "macos"
    return "linux"


def status() -> dict:
    with _lock:
        st = dict(_status)
    os_name = detect_os()
    arch = platform.machine()
    # 本机 CPU 优选的变体（最快兼容者），供前端在「自动」选项里提示
    pref = _auto_variant_order(os_name, arch)
    # 变体清单：优先用真实下载包内的，没有则按平台给出预期清单，保证首屏也能展示三档
    variants = st.get("variants") or expected_variants(os_name, arch)
    st.update({
        "installed": is_installed(),
        "on_path": bool(shutil.which("pikafish")),
        "os": os_name,
        "arch": arch,
        "recommended_variant": pref[0] if pref else None,
        "recommended_label": _variant_label(pref[0]) if pref else "",
        "cpu_detected": bool(pref),
        "cpu_detect_note": _cpu_detect_note,
        "variants": variants,
        "variant_info": _variant_info(variants, os_name, arch),
        "dir": os.path.abspath(engine_dir()),
        "meta": read_meta(),
    })
    return st


def _set(**kw) -> None:
    with _lock:
        _status.update(kw)


def sanitize_variant(v: str | None) -> str | None:
    """变体仅作为发布包内文件名的子串匹配用，限制为安全字符集。"""
    if not v:
        return None
    v = v.strip().lower()
    return v if re.fullmatch(r"[a-z0-9._\-]{1,40}", v) else None


# ── 选择适配本机的可执行文件 ────────────────────────────────────

def _basename(n: str) -> str:
    """取归档条目的文件名，兼容 / 与 \\ 两种分隔符（py7zr/zip 行为可能不同）。"""
    return re.split(r"[\\/]", n)[-1]


def _candidates(names: list[str], os_name: str) -> list[str]:
    toks = _OS_TOKENS[os_name]
    want_exe = os_name == "windows"

    def ok(n: str) -> bool:
        base = _basename(n).lower()
        if not base.startswith("pikafish"):
            return False
        if base.endswith(_SKIP_EXT):
            return False
        return want_exe == base.endswith(".exe")

    cands = [n for n in names if ok(n)]
    with_tok = [n for n in cands if any(t in n.lower() for t in toks)]
    return with_tok or cands  # 找不到带平台标记的就退回全部候选


def _rank_candidates(
    cands: list[str], os_name: str, arch: str
) -> list[str]:
    """自动模式下把候选按「优先尝试顺序」排序：本机 CPU 撑得动的最快变体在前。

    探测到 CPU 信息时按 _auto_variant_order；探测不到则回退「最兼容优先」。
    返回完整排序列表，供自检失败时逐个回退。
    """
    auto_order = _auto_variant_order(os_name, arch)

    def auto_rank(n: str) -> int:
        low = n.lower()
        for i, kw in enumerate(auto_order):
            if kw in low:
                return i
        return len(auto_order)

    def compat_rank(n: str) -> int:
        low = n.lower()
        for i, kw in enumerate(_COMPAT_ASC):
            if kw in low:
                return i
        return len(_COMPAT_ASC)

    # 先按本机优选顺序，再以「最兼容」作为同级及未匹配项的次级排序键
    return sorted(cands, key=lambda n: (auto_rank(n), compat_rank(n)))


def _choose(cands: list[str], variant: str | None, os_name: str, arch: str) -> str | None:
    if not cands:
        return None
    if variant:
        for n in cands:
            if variant in n.lower():
                return n
        return None  # 指定的变体在包内不存在
    ranked = _rank_candidates(cands, os_name, arch)
    return ranked[0] if ranked else None


# ── 下载 ────────────────────────────────────────────────────────

def _http_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def _download(url: str, dst: str) -> None:
    req = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(req, timeout=300) as resp, open(dst, "wb") as f:
        _set(total=int(resp.headers.get("Content-Length") or 0), downloaded=0)
        read = 0
        while True:
            chunk = resp.read(262144)
            if not chunk:
                break
            f.write(chunk)
            read += len(chunk)
            _set(downloaded=read)


def _import_py7zr():
    try:
        import py7zr

        return py7zr
    except ImportError as e:
        raise RuntimeError("缺少依赖 py7zr，无法解压 .7z 发布包，请先 pip install py7zr") from e


def _archive_names(path: str) -> list[str]:
    """列出归档内所有条目名，支持 .7z（py7zr）与 .zip。"""
    if path.lower().endswith(".7z"):
        with _import_py7zr().SevenZipFile(path, "r") as z:
            return z.getnames()
    with zipfile.ZipFile(path) as zf:
        return zf.namelist()


def _extract_targets(path: str, targets: list[str], dest: str) -> None:
    """仅解压指定条目到 dest（保留归档内层级），支持 .7z 与 .zip。"""
    if path.lower().endswith(".7z"):
        with _import_py7zr().SevenZipFile(path, "r") as z:
            z.extract(path=dest, targets=targets)
        return
    with zipfile.ZipFile(path) as zf:
        for t in targets:
            zf.extract(t, dest)


def _find_file(root: str, base: str) -> str | None:
    """在解压目录下按文件名查找（不区分大小写），兼容任意子目录布局。"""
    base_l = base.lower()
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            if f.lower() == base_l:
                return os.path.join(dirpath, f)
    return None


# ── 安装流程 ────────────────────────────────────────────────────

def _verify() -> bool:
    """启动一次握手自检，确认下载的可执行文件能在本机正常运行。"""
    from .engine import Engine

    try:
        eng = Engine(path=binary_path())
    except Exception:
        return False
    alive = eng.is_alive()
    try:
        eng.close()
    except Exception:
        pass
    return alive


def _do_install(variant: str | None) -> None:
    from .engine import reset_shared_engine

    try:
        _set(state="downloading", message="查询最新版本…", error="",
             downloaded=0, total=0, variant=None)
        rel = _http_json(_LATEST_API)
        tag = rel.get("tag_name", "")
        assets = rel.get("assets", [])
        # 官方发布包是单个 .7z（兜底兼容 .zip）
        asset = next(
            (a for a in assets if str(a.get("name", "")).lower().endswith(".7z")), None
        ) or next(
            (a for a in assets if str(a.get("name", "")).lower().endswith(".zip")), None
        )
        if not asset:
            raise RuntimeError("未在最新 Release 中找到 .7z / .zip 发布包")
        asset_name = str(asset.get("name", ""))
        asset_url = asset.get("browser_download_url")

        os.makedirs(engine_dir(), exist_ok=True)
        ext = ".7z" if asset_name.lower().endswith(".7z") else ".zip"
        archive = os.path.join(engine_dir(), "_download" + ext)
        _set(message=f"下载 {tag} …")
        _download(asset_url, archive)

        _set(state="extracting", message="解压并选择适配本机的可执行文件…")
        os_name = detect_os()
        arch = platform.machine()
        names = _archive_names(archive)
        cands = _candidates(names, os_name)
        _set(variants=sorted({_basename(n) for n in cands}))
        nnue_entry = next(
            (n for n in names if _basename(n).lower() == "pikafish.nnue"), None
        )
        if not nnue_entry:
            raise RuntimeError("发布包内缺少 pikafish.nnue 权重文件")

        if variant:
            # 指定了变体：只装这一个，不做回退
            chosen = _choose(cands, variant, os_name, arch)
            if not chosen:
                raise RuntimeError(f"发布包内不存在变体 {variant}")
            attempts = [chosen]
        else:
            # 自动模式：按本机 CPU「最快→最兼容」排序，逐个尝试直到自检通过
            attempts = _rank_candidates(cands, os_name, arch)
            if not attempts:
                raise RuntimeError(f"未找到适配 {os_name} 的可执行文件")

        chosen = None
        last_err = ""
        for i, cand in enumerate(attempts):
            label = _basename(cand)
            tmpdir = tempfile.mkdtemp(prefix="pikafish_", dir=engine_dir())
            try:
                _extract_targets(archive, [cand, nnue_entry], tmpdir)
                bin_src = _find_file(tmpdir, _basename(cand))
                nnue_src = _find_file(tmpdir, "pikafish.nnue")
                if not bin_src or not nnue_src:
                    raise RuntimeError("解压后未找到可执行文件或权重文件")
                # 写入前先释放可能正在运行的引擎进程（Windows 下文件会被锁）
                reset_shared_engine()
                shutil.copyfile(bin_src, binary_path())
                shutil.copyfile(nnue_src, nnue_path())
            finally:
                shutil.rmtree(tmpdir, ignore_errors=True)

            if os.name != "nt":
                mode = os.stat(binary_path()).st_mode
                os.chmod(binary_path(), mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

            _set(state="verifying", message=f"启动引擎自检（{label}）…", variant=label)
            if _verify():
                chosen = cand
                break
            last_err = f"{label} 与本机 CPU 不兼容"
            # 还有更兼容的候选则自动回退重试
            if i + 1 < len(attempts):
                nxt = _basename(attempts[i + 1])
                _set(message=f"{label} 自检失败，回退到更兼容的 {nxt} 重试…")

        try:
            os.remove(archive)
        except OSError:
            pass

        if not chosen:
            raise RuntimeError(
                "已尝试全部适配变体但均自检失败" + (f"：{last_err}" if last_err else "")
            )

        meta = {
            "version": tag,
            "variant": chosen.rsplit("/", 1)[-1],
            "os": os_name,
            "arch": arch,
            "installed_at": datetime.datetime.now().isoformat(timespec="seconds"),
        }
        with open(_meta_path(), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

        reset_shared_engine()  # 让新引擎立即被对弈/评分/分析复用
        _set(state="done", message=f"已安装 Pikafish {tag}（{meta['variant']}）",
             variant=meta["variant"])
    except Exception as e:  # noqa: BLE001 — 安装失败需把原因如实回传前端
        _set(state="error", error=str(e), message="安装失败")


def start_install(variant: str | None) -> dict:
    """启动后台安装；若已有安装进行中则拒绝。"""
    with _lock:
        if _status["state"] in ("downloading", "extracting", "verifying"):
            return {"started": False, "reason": "安装正在进行中"}
        _status.update(state="downloading", message="准备中…", error="",
                       downloaded=0, total=0)
    threading.Thread(target=_do_install, args=(variant,), daemon=True).start()
    return {"started": True}


def remove() -> None:
    """删除受管目录中的引擎与权重，回退到 PATH / 内置引擎。"""
    from .engine import reset_shared_engine

    reset_shared_engine()
    for p in (binary_path(), nnue_path(), _meta_path()):
        try:
            os.remove(p)
        except OSError:
            pass
    _set(state="idle", message="", error="", variant=None)
