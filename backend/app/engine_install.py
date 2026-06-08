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

# 变体兼容性从高到低；默认挑「最兼容」者（靠前），即便慢一点也优先保证能跑起来。
_COMPAT_ASC = [
    "sse41-popcnt", "sse41", "ssse3", "popcnt", "sse2",
    "apple-silicon", "armv8", "armv7", "modern", "x86-64",
    "avx2", "bmi2", "avxvnni", "vnni256", "avx512", "vnni512",
]

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
    return os.path.join(engine_dir(), binary_name())


def nnue_path() -> str:
    return os.path.join(engine_dir(), "pikafish.nnue")


def _meta_path() -> str:
    return os.path.join(engine_dir(), "meta.json")


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
    st.update({
        "installed": is_installed(),
        "on_path": bool(shutil.which("pikafish")),
        "os": detect_os(),
        "arch": platform.machine(),
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


def _choose(cands: list[str], variant: str | None) -> str | None:
    if not cands:
        return None
    if variant:
        for n in cands:
            if variant in n.lower():
                return n
        return None  # 指定的变体在包内不存在

    def rank(n: str) -> int:
        low = n.lower()
        for i, kw in enumerate(_COMPAT_ASC):
            if kw in low:
                return i
        return len(_COMPAT_ASC)

    return sorted(cands, key=rank)[0]


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
        names = _archive_names(archive)
        cands = _candidates(names, os_name)
        _set(variants=sorted({_basename(n) for n in cands}))
        chosen = _choose(cands, variant)
        if not chosen:
            raise RuntimeError(
                f"未找到适配 {os_name} 的可执行文件"
                + (f"（变体 {variant} 不存在）" if variant else "")
            )
        nnue_entry = next(
            (n for n in names if _basename(n).lower() == "pikafish.nnue"), None
        )
        if not nnue_entry:
            raise RuntimeError("发布包内缺少 pikafish.nnue 权重文件")

        tmpdir = tempfile.mkdtemp(prefix="pikafish_", dir=engine_dir())
        try:
            _extract_targets(archive, [chosen, nnue_entry], tmpdir)
            bin_src = _find_file(tmpdir, _basename(chosen))
            nnue_src = _find_file(tmpdir, "pikafish.nnue")
            if not bin_src or not nnue_src:
                raise RuntimeError("解压后未找到可执行文件或权重文件")
            # 写入前先释放可能正在运行的引擎进程（Windows 下文件会被锁）
            reset_shared_engine()
            shutil.copyfile(bin_src, binary_path())
            shutil.copyfile(nnue_src, nnue_path())
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
            try:
                os.remove(archive)
            except OSError:
                pass

        if os.name != "nt":
            mode = os.stat(binary_path()).st_mode
            os.chmod(binary_path(), mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

        _set(state="verifying", message="启动引擎自检…")
        if not _verify():
            raise RuntimeError("引擎已下载但自检失败：该变体可能与本机 CPU 不兼容，请改选更兼容的变体")

        meta = {
            "version": tag,
            "variant": chosen.rsplit("/", 1)[-1],
            "os": os_name,
            "arch": platform.machine(),
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
