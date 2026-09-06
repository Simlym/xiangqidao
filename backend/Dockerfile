# IMAGE_REGISTRY 经 docker-compose.yml 的 build.args 注入，缺省走国内加速源
ARG IMAGE_REGISTRY=docker.m.daocloud.io
FROM ${IMAGE_REGISTRY}/library/python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -i ${PIP_INDEX_URL} -r requirements.txt

COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
COPY seeds ./seeds

RUN mkdir -p /app/data/engine

EXPOSE 8000

CMD ["python", "-m", "app"]
