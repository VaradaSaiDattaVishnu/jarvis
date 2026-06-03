#!/bin/bash

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║       🤖  J.A.R.V.I.S  Setup                ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install from https://nodejs.org"
    exit 1
fi
echo "✅ Node.js $(node -v)"

# Check Python
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo "❌ Python not found. Install from https://python.org"
    exit 1
fi
PYTHON=$(command -v python3 || command -v python)
echo "✅ Python $($PYTHON --version 2>&1)"

# Install Node dependencies
echo ""
echo "📦 Installing Node.js dependencies..."
npm install

# Install edge-tts
echo ""
echo "🔊 Installing Edge TTS..."
$PYTHON -m pip install edge-tts --quiet 2>/dev/null || pip install edge-tts --quiet 2>/dev/null

# Check edge-tts
if ! command -v edge-tts &> /dev/null; then
    echo "⚠️  edge-tts not in PATH. Try: pip install edge-tts"
fi

# Create .env if not exists
if [ ! -f .env ]; then
    cp .env.example .env
    echo ""
    echo "⚠️  Created .env file. You MUST add your Groq API key!"
    echo ""
    echo "   1. Go to https://console.groq.com/keys (it's FREE)"
    echo "   2. Create an API key"
    echo "   3. Open .env and paste it"
    echo ""
fi

echo ""
echo "════════════════════════════════════════════════"
echo ""
echo "  ✅ Setup complete!"
echo ""
echo "  Next steps:"
echo "    1. Get your FREE Groq API key: https://console.groq.com/keys"
echo "    2. Add it to .env file: GROQ_API_KEY=your_key_here"
echo "    3. Run: npm start"
echo "    4. Open: http://localhost:3000"
echo ""
echo "════════════════════════════════════════════════"
