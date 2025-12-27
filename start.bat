@echo off
echo Starting Super AI Plugin...

where pnpm >nul 2>nul
if %errorlevel% neq 0 (
    echo pnpm could not be found. Installing...
    npm install -g pnpm
)

echo Installing dependencies...
call pnpm install

echo Building...
call pnpm run build

echo Starting Hub...
call pnpm start:all
