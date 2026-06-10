"""Convenience launcher for the ScholarlE Engen web app.

Run this file from PyCharm to start the local app, then open:
http://127.0.0.1:8000/
"""

import uvicorn


if __name__ == "__main__":
    print("Starting ScholarlE Engen at http://127.0.0.1:8000/")
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
