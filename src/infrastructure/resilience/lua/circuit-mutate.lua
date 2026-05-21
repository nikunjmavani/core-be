-- Atomic circuit breaker state transition (one round trip, no WATCH/MULTI retry loop).
-- KEYS[1] = circuit redis key
-- ARGV[1] = command: record_success | record_failure | attempt_half_open | force_open
-- ARGV[2] = failure_threshold (number)
-- ARGV[3] = max_half_open_attempts (number)
-- ARGV[4] = reset_timeout_ms (number)
-- ARGV[5] = now_ms (number)

local key = KEYS[1]
local command = ARGV[1]
local failure_threshold = tonumber(ARGV[2])
local max_half_open_attempts = tonumber(ARGV[3])
local reset_timeout_ms = tonumber(ARGV[4])
local now_ms = tonumber(ARGV[5])

local default_state = '{"state":"CLOSED","failures":0,"lastFailureTime":0,"halfOpenAttempts":0}'
local raw = redis.call('GET', key)
if not raw then
  raw = default_state
end

local state = cjson.decode(raw)
if not state.state then
  state = cjson.decode(default_state)
end

local function write(next)
  redis.call('SET', key, cjson.encode(next), 'EX', 3600)
  return cjson.encode(next)
end

if command == 'record_success' then
  return write({ state = 'CLOSED', failures = 0, lastFailureTime = 0, halfOpenAttempts = 0 })
end

if command == 'record_failure' then
  local next_failures = (state.failures or 0) + 1
  local next_half_open_attempts = 0
  if state.state == 'HALF_OPEN' then
    next_half_open_attempts = (state.halfOpenAttempts or 0) + 1
  end
  local next_state = state.state or 'CLOSED'
  if next_failures >= failure_threshold then
    next_state = 'OPEN'
  elseif state.state == 'HALF_OPEN' and next_half_open_attempts >= max_half_open_attempts then
    next_state = 'OPEN'
  end
  return write({
    state = next_state,
    failures = next_failures,
    lastFailureTime = now_ms,
    halfOpenAttempts = next_half_open_attempts,
  })
end

if command == 'attempt_half_open' then
  if state.state ~= 'OPEN' then
    return cjson.encode(state)
  end
  local elapsed = now_ms - (state.lastFailureTime or 0)
  if elapsed < reset_timeout_ms then
    return cjson.encode(state)
  end
  return write({
    state = 'HALF_OPEN',
    failures = 0,
    lastFailureTime = state.lastFailureTime or 0,
    halfOpenAttempts = 0,
  })
end

if command == 'force_open' then
  return write({
    state = 'OPEN',
    failures = state.failures or 0,
    lastFailureTime = state.lastFailureTime or now_ms,
    halfOpenAttempts = state.halfOpenAttempts or 0,
  })
end

return cjson.encode(state)
