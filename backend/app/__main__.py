"""Allow the backend to be started with ``python -m app``."""

import os

import uvicorn


def main() -> None:
    """Start the ASGI server using environment-configurable defaults."""
    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("RELOAD", "").lower() in {"1", "true", "yes", "on"},
        proxy_headers=True,
        forwarded_allow_ips=os.getenv("FORWARDED_ALLOW_IPS", "127.0.0.1"),
    )


if __name__ == "__main__":
    main()
