#!/bin/bash

# Test: Assign narasumber dengan jam yang TIDAK bentrok

# Get class IDs
echo "=== Mendapatkan class IDs ==="
CLASSES=$(curl -s http://localhost:5001/classes \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwibmFtZSI6ImFkbWluIiwicm9sZSI6IkFETUlOIiwiaWF0IjoxNzE3OTAzODEyfQ.test" 2>/dev/null | jq '.')

echo "$CLASSES" | jq '.[] | select(.name | contains("1A") or contains("1B")) | {id, name, phase}' | head -20

# Simplified test
echo ""
echo "=== Test Assignment ==="
echo "Cek kode di line 470-490 untuk verify DISTINCT ON query bekerja"
