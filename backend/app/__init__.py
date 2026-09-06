"""象棋道后端应用包。

导入期最先加载 .env(实现见 core/env.py),保证 main、auth、database
等模块在导入时读取的环境变量已包含文件中的配置。
"""

from .core.env import load_dotenv as _load_dotenv

_load_dotenv()
