"""外观商店接口的请求与响应结构。"""

from pydantic import BaseModel


class PurchaseIn(BaseModel):
    asset_key: str
