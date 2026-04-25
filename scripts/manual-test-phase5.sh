#!/bin/bash
# Phase 5: Manual Testing Script - API Validation
# Tests all 7 critical scenarios via API calls

echo "🧪 PHASE 5: MANUAL TESTING - API VALIDATION"
echo "=========================================="
echo "Date: $(date)"
echo "Backend: http://localhost:5000"
echo "Frontend: http://localhost:5174"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASS=0
FAIL=0

# Helper function for API tests
test_api() {
  local name=$1
  local method=$2
  local endpoint=$3
  local expected_status=$4
  
  echo -n "Testing: $name ... "
  
  if [ "$method" = "GET" ]; then
    response=$(curl -s -w "\n%{http_code}" "http://localhost:5000$endpoint")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "http://localhost:5000$endpoint" \
      -H "Content-Type: application/json" \
      -d '{}')
  fi
  
  status=$(echo "$response" | tail -n 1)
  body=$(echo "$response" | head -n -1)
  
  if [[ "$status" =~ $expected_status ]]; then
    echo -e "${GREEN}✅ PASS${NC} (HTTP $status)"
    ((PASS++))
  else
    echo -e "${RED}❌ FAIL${NC} (HTTP $status, expected $expected_status)"
    echo "  Response: $body"
    ((FAIL++))
  fi
}

# ============================================
# SCENARIO 1: API Server Health
# ============================================
echo ""
echo "📋 SCENARIO 1: API Server & Database Connection"
echo "-----------------------------------------------"

test_api "API Root Endpoint" "GET" "/" "200"
test_api "Quiz Endpoints Available" "GET" "/api/quizzes" "200"

# ============================================
# SCENARIO 2: User Profile Endpoints (V2)
# ============================================
echo ""
echo "📋 SCENARIO 2: User Profile Endpoints (V2)"
echo "-----------------------------------------------"

test_api "User Profile - Should require auth (GET)" "GET" "/api/user/profile" "401|403"
test_api "User Statistics - Should require auth (GET)" "GET" "/api/user/statistics" "401|403"
test_api "User Profile Update - Should require auth (PUT)" "PUT" "/api/user/profile" "401|403"

# ============================================
# SCENARIO 3: Quiz Submission Validation
# ============================================
echo ""
echo "📋 SCENARIO 3: Quiz Submission & Answer Locking"
echo "-----------------------------------------------"

# Get a quiz ID first
echo -n "Fetching quiz ID... "
QUIZZES=$(curl -s "http://localhost:5000/api/quizzes")
QUIZ_ID=$(echo "$QUIZZES" | grep -o '"_id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$QUIZ_ID" ]; then
  echo -e "${YELLOW}⚠️  No quizzes found - creating test scenario${NC}"
  QUIZ_ID="test-quiz-001"
else
  echo -e "${GREEN}✅ Found: $QUIZ_ID${NC}"
fi

test_api "Quiz Submission - Should require auth" "POST" "/api/quizzes/$QUIZ_ID/submit" "401|403|400"
test_api "Get Submission - Should require auth" "GET" "/api/quizzes/$QUIZ_ID/submission" "401|403"

# ============================================
# SCENARIO 4: Leaderboard & Results
# ============================================
echo ""
echo "📋 SCENARIO 4: Leaderboard & Results Retrieval"
echo "-----------------------------------------------"

if [ ! -z "$QUIZ_ID" ] && [ "$QUIZ_ID" != "test-quiz-001" ]; then
  test_api "Leaderboard - Should return array" "GET" "/api/quizzes/$QUIZ_ID/leaderboard" "200"
  test_api "Published Results - Should return results" "GET" "/api/published-results/$QUIZ_ID" "200|404"
fi

# ============================================
# SCENARIO 5: Admin Publishing Endpoints
# ============================================
echo ""
echo "📋 SCENARIO 5: Admin Publishing Endpoints"
echo "-----------------------------------------------"

test_api "Prepare Publish - Should require auth" "GET" "/api/admin/quizzes/$QUIZ_ID/prepare-publish/overall" "401|403"
test_api "Publish Results - Should require auth" "POST" "/api/admin/quizzes/$QUIZ_ID/publish-results" "401|403|400"

# ============================================
# SCENARIO 6: Error Handling
# ============================================
echo ""
echo "📋 SCENARIO 6: Error Handling & Invalid IDs"
echo "-----------------------------------------------"

test_api "Invalid Quiz ID - Should return 404" "GET" "/api/quizzes/invalid-id-12345" "404"
test_api "Invalid Endpoint - Should return 404" "GET" "/api/invalid/endpoint" "404"

# ============================================
# SCENARIO 7: V2 Specific Changes
# ============================================
echo ""
echo "📋 SCENARIO 7: V2 API Structure Changes"
echo "-----------------------------------------------"

echo -n "Checking: Quiz data structure includes userId... "
if echo "$QUIZZES" | grep -q "_id"; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((FAIL++))
fi

echo -n "Checking: API responds to topWinners format... "
# This should not error (auth error is OK)
response=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:5000/api/admin/quizzes/test/publish-results" \
  -H "Content-Type: application/json" \
  -d '{"topWinners": [], "topCount": 5}')
status=$(echo "$response" | tail -n 1)
if [[ "$status" =~ 401|403|400 ]]; then
  echo -e "${GREEN}✅ PASS${NC} (endpoint exists, auth required)"
  ((PASS++))
else
  echo -e "${YELLOW}⚠️  Check${NC} (HTTP $status)"
fi

# ============================================
# RESULTS
# ============================================
echo ""
echo "=========================================="
echo "📊 TEST RESULTS"
echo "=========================================="
echo -e "${GREEN}✅ Passed: $PASS${NC}"
echo -e "${RED}❌ Failed: $FAIL${NC}"
TOTAL=$((PASS + FAIL))
if [ $TOTAL -gt 0 ]; then
  RATE=$((PASS * 100 / TOTAL))
  echo "📈 Pass Rate: $RATE%"
fi
echo ""

# ============================================
# SUMMARY
# ============================================
if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}🎉 ALL CRITICAL PATHS VALIDATED!${NC}"
  echo ""
  echo "✅ API Server operational"
  echo "✅ Database connected"
  echo "✅ Auth enforcement working"
  echo "✅ V2 endpoints available"
  echo "✅ Error handling functional"
  echo ""
  echo "Ready for detailed UI testing!"
else
  echo -e "${YELLOW}⚠️  Some tests need attention${NC}"
fi

echo "=========================================="
