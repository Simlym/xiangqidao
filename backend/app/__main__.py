"""Allow the backend to be started with ``python -m app``."""

import os

import uvicorn


def main() -> None:
    """Start the ASGI server using environment-configurable defaults."""
    uvicorn.run(
        "app.main:app",
        host=os.getenv("XQ_HOST", "127.0.0.1"),
        port=int(os.getenv("XQ_PORT", "8000")),
        reload=os.getenv("XQ_RELOAD", "").lower() in {"1", "true", "yes", "on"},
        proxy_headers=True,
        forwarded_allow_ips=os.getenv("XQ_FORWARDED_ALLOW_IPS", "127.0.0.1"),
    )


if __name__ == "__main__":
    main()
