#!/bin/bash
echo "Starting Super AI Plugin..."

# Check for pnpm
if ! command -v pnpm &> /dev/null
then
    echo "pnpm could not be found. Installing..."
    npm install -g pnpm
fi

echo "Installing dependencies..."
pnpm install

echo "Building..."
pnpm run build

echo "Starting Hub..."
pnpm start:all
