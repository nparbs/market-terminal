@echo off
cd /d "%~dp0"
python -c "import fastapi, uvicorn, httpx" 2>nul || (
  echo Installing dependencies...
  python -m pip install -r requirements.txt
)
start "" http://127.0.0.1:8765
python -m server.app
pause
