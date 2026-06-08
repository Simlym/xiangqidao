"""统一的请求限流：基于客户端 IP 的滑动窗口，防暴力破解与 CPU 型 DoS。

集中在此模块导出单例 limiter，供 main 装配与各路由按需 @limiter.limit 标注。
注意：限流以 request.client.host 为键，生产务必让应用跑在反向代理后，并以
`uvicorn --proxy-headers --forwarded-allow-ips=<反代IP>` 启动，否则取到的会是
代理 IP（所有人共用一个键）或可被伪造的 XFF。
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

# 默认不设全局限额，仅对显式标注的接口生效；标注里再给具体速率。
limiter = Limiter(key_func=get_remote_address)
