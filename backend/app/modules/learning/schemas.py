"""学习画像接口的请求与响应结构。"""

from pydantic import BaseModel


class PackOut(BaseModel):
    id: str
    type: str
    title: str
    puzzle_ids: list[int]
    completed: bool
    baseline: dict
