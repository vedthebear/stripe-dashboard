#!/bin/bash

echo "🔍 Checking Stripe Dashboard Server Status..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "📡 Main Server (port 5050):"
main_server=$(lsof -i :5050 2>/dev/null | grep LISTEN)
if [ -n "$main_server" ]; then
    echo "   ✅ Running - $main_server"
    echo "   🌐 API: http://localhost:5050/api/supabase/analytics"
else
    echo "   ❌ Not running"
fi

echo ""
echo "🪝 Webhook Server (port 3001):"
webhook_server=$(lsof -i :3001 2>/dev/null | grep LISTEN)
if [ -n "$webhook_server" ]; then
    echo "   ✅ Running - $webhook_server"
    echo "   🌐 Endpoint: http://localhost:3001/webhook"
else
    echo "   ❌ Not running"
fi

echo ""
echo "⚛️  React Client (port 3000):"
react_client=$(lsof -i :3000 2>/dev/null | grep LISTEN)
if [ -n "$react_client" ]; then
    echo "   ✅ Running - $react_client"
    echo "   🌐 Dashboard: http://localhost:3000"
else
    echo "   ❌ Not running"
fi

echo ""
echo "🚇 ngrok Tunnel:"
ngrok_tunnel=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https://[^"]*' | cut -d'"' -f4)
if [ -n "$ngrok_tunnel" ]; then
    echo "   ✅ Running - $ngrok_tunnel"
    echo "   🪝 Webhook URL: $ngrok_tunnel/webhook"
else
    echo "   ❌ Not running"
fi

echo ""
echo "📊 Node.js Processes:"
node_processes=$(ps aux | grep -E "(node|npm)" | grep -v grep | wc -l)
echo "   🔢 Total Node processes: $node_processes"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 Quick Commands:"
echo "   Main Server:    node server/index.js"
echo "   Webhook Server: node webhook-server.js"
echo "   React Client:   cd client && npm start"
echo "   ngrok:          ngrok http 3001"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"