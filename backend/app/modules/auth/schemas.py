"""鉴权与账号接口的请求与响应结构。"""

from datetime import datetime

from pydantic import BaseModel, Field


class Credentials(BaseModel):
    # 限长防超大请求体；下限在业务里校验以返回中文友好提示
    username: str = Field(max_length=40)
    password: str = Field(max_length=128)


class AuthResponse(BaseModel):
    token: str
    username: str
    role: str


class UserOut(BaseModel):
    username: str
    role: str


class EntitlementsOut(BaseModel):
    plan: str
    active: bool
    expires_at: datetime | None
    features: list[str]
