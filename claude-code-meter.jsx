// Claude Code Meter - Ubersicht Widget
// Shows 5-hour and 7-day session usage with reset timers
// Click the mode badge in the header to toggle between "remaining" and "used"

import { run } from "uebersicht";

// ── SETTINGS ────────────────────────────────────────────
const DEFAULT_MODE = "remaining"; // "remaining" or "used"
const REFRESH_MS = 300000;        // 5 minutes
// ─────────────────────────────────────────────────────────

export const refreshFrequency = REFRESH_MS;

export const command = `
  BACKOFF_FILE="/tmp/claude-code-meter-backoff"
  CACHE_FILE="/tmp/claude-code-meter-cache"

  # Backoff: if rate limited, skip calls and serve cached data
  if [ -f "$BACKOFF_FILE" ]; then
    BACKOFF_UNTIL=$(cat "$BACKOFF_FILE" 2>/dev/null)
    NOW_S=$(date +%s)
    if [ "$NOW_S" -lt "$BACKOFF_UNTIL" ] 2>/dev/null; then
      WAIT=$((BACKOFF_UNTIL - NOW_S))
      if [ -f "$CACHE_FILE" ]; then
        CACHED=$(cat "$CACHE_FILE")
        # Inject _stale flag and retry info into cached response
        echo "$CACHED" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); d['_stale']=True; d['_retryIn']=$WAIT; print(json.dumps(d))"
        exit 0
      fi
      echo '{"_widgetError": "rate_limited_backoff", "_retryIn": '"$WAIT"'}'
      exit 0
    fi
    rm -f "$BACKOFF_FILE"
  fi

  CREDS=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null) || \
    { echo '{"_widgetError": "no_credentials"}'; exit 0; }

  TOKEN=$(echo "$CREDS" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['claudeAiOauth']['accessToken'])" 2>/dev/null) || \
    { echo '{"_widgetError": "parse_error"}'; exit 0; }

  EXPIRES=$(echo "$CREDS" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['claudeAiOauth']['expiresAt'])" 2>/dev/null)
  NOW_MS=$(python3 -c "import time; print(int(time.time()*1000))")

  if [ -n "$EXPIRES" ] && [ "$NOW_MS" -gt "$EXPIRES" ] 2>/dev/null; then
    echo '{"_widgetError": "token_expired"}'
    exit 0
  fi

  RESPONSE=$(curl -s -w "\\n%{http_code}" https://api.anthropic.com/api/oauth/usage \
    -H "Authorization: Bearer $TOKEN" \
    -H "anthropic-beta: oauth-2025-04-20" \
    -H "Content-Type: application/json" \
    -H "User-Agent: claude-code/2.1.0" 2>/dev/null)

  if [ -z "$RESPONSE" ]; then
    echo '{"_widgetError": "network_error"}'
    exit 0
  fi

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
    echo '{"_widgetError": "auth_failed"}'
    exit 0
  fi

  if [ "$HTTP_CODE" = "429" ]; then
    # Exponential backoff: 5min, 10min, max 15min
    NOW_S=$(date +%s)
    PREV_WAIT=0
    if [ -f "$BACKOFF_FILE.wait" ]; then
      PREV_WAIT=$(cat "$BACKOFF_FILE.wait" 2>/dev/null)
    fi
    if [ "$PREV_WAIT" -lt 300 ] 2>/dev/null; then
      NEXT_WAIT=300
    elif [ "$PREV_WAIT" -lt 900 ] 2>/dev/null; then
      NEXT_WAIT=$((PREV_WAIT * 2))
      if [ "$NEXT_WAIT" -gt 900 ]; then NEXT_WAIT=900; fi
    else
      NEXT_WAIT=900
    fi
    echo $((NOW_S + NEXT_WAIT)) > "$BACKOFF_FILE"
    echo "$NEXT_WAIT" > "$BACKOFF_FILE.wait"
    # Serve cached data if available
    if [ -f "$CACHE_FILE" ]; then
      CACHED=$(cat "$CACHE_FILE")
      echo "$CACHED" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); d['_stale']=True; d['_retryIn']=$NEXT_WAIT; print(json.dumps(d))"
      exit 0
    fi
    echo '{"_widgetError": "rate_limited", "_retryIn": '"$NEXT_WAIT"'}'
    exit 0
  fi

  # Success - clear any backoff state
  rm -f "$BACKOFF_FILE" "$BACKOFF_FILE.wait"

  if [ "$HTTP_CODE" != "200" ]; then
    echo '{"_widgetError": "api_error", "_httpCode": '"$HTTP_CODE"'}'
    exit 0
  fi

  # Cache successful response
  echo "$BODY" > "$CACHE_FILE"

  echo "$BODY"
`;

export const initialState = { mode: DEFAULT_MODE, rateLimitedSince: null };

export const updateState = (event, previousState) => {
  if (event.type === "TOGGLE_MODE") {
    return {
      ...previousState,
      mode: previousState.mode === "remaining" ? "used" : "remaining",
    };
  }
  if (event.type === "REAUTH") {
    return { ...previousState, reauthing: true };
  }
  if (event.type === "UB/COMMAND_RAN") {
    let parsed;
    try { parsed = JSON.parse(event.output); } catch {}
    const isRateLimited = parsed && parsed._widgetError === "rate_limited";
    return {
      ...previousState,
      output: event.output,
      error: event.error,
      reauthing: false,
      rateLimitedSince: isRateLimited
        ? (previousState.rateLimitedSince || Date.now())
        : null,
    };
  }
  return previousState;
};

const AMBER = "#e8a020";
const AMBER_DIM = "#e8a02040";
const AMBER_GLOW = "#e8a02080";
const GREEN = "#40c040";
const GREEN_DIM = "#40c04040";
const GREEN_GLOW = "#40c04060";
const RED = "#e04040";
const RED_DIM = "#e0404040";
const BG = "rgba(10, 10, 12, 0.88)";
const BORDER = "#e8a02030";
const TEXT_DIM = "#e8a02099";
const PACE_MARKER = "#ffffff";

const WINDOW_5H_MS = 5 * 60 * 60 * 1000;
const WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000;

function formatTimeLeft(resetAt) {
  if (!resetAt) return { timeStr: "--:--:--", label: "no data" };
  const now = new Date();
  const reset = new Date(resetAt);
  const diff = reset - now;
  if (diff <= 0) return { timeStr: "00:00:00", label: "resetting..." };
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const timeStr = `${pad(h)}:${pad(m)}:${pad(s)}`;
  if (h >= 24) {
    const days = Math.floor(h / 24);
    const remH = h % 24;
    return { timeStr: `${days}d ${pad(remH)}:${pad(m)}`, label: `resets in ${days}d ${remH}h` };
  }
  return { timeStr, label: `resets in ${h}h ${m}m` };
}

function formatResetTime(resetAt) {
  if (!resetAt) return "--:--";
  const d = new Date(resetAt);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}

function getBarColor(displayValue, mode) {
  if (mode === "remaining") {
    if (displayValue <= 10) return { bar: RED, dim: RED_DIM, glow: "#e0404060" };
    if (displayValue <= 25) return { bar: AMBER, dim: AMBER_DIM, glow: AMBER_GLOW };
    return { bar: GREEN, dim: GREEN_DIM, glow: GREEN_GLOW };
  }
  if (displayValue >= 90) return { bar: RED, dim: RED_DIM, glow: "#e0404060" };
  return { bar: AMBER, dim: AMBER_DIM, glow: AMBER_GLOW };
}

function UsageBar({ displayValue, mode, paceMarker, segments = 20 }) {
  const filled = Math.round((displayValue / 100) * segments);
  const markerSeg = paceMarker != null ? Math.round((paceMarker / 100) * segments) : null;
  const colors = getBarColor(displayValue, mode);
  // Each segment is 8px wide + 2px gap = 10px per segment
  const segWidth = 8;
  const segGap = 2;
  return (
    <div style={{ position: "relative", display: "flex", gap: `${segGap}px`, alignItems: "center" }}>
      {Array.from({ length: segments }, (_, i) => (
        <div
          key={i}
          style={{
            width: `${segWidth}px`,
            height: "18px",
            borderRadius: "1px",
            backgroundColor: i < filled ? colors.bar : colors.dim,
            boxShadow: i < filled ? `0 0 4px ${colors.glow}` : "none",
            transition: "background-color 0.3s ease",
          }}
        />
      ))}
      {markerSeg != null && markerSeg >= 0 && markerSeg <= segments && (
        <div
          style={{
            position: "absolute",
            left: `${markerSeg * (segWidth + segGap) - 1}px`,
            top: "-3px",
            width: "0",
            height: "0",
            borderLeft: "4px solid transparent",
            borderRight: "4px solid transparent",
            borderTop: `5px solid ${PACE_MARKER}`,
            opacity: 0.7,
          }}
          title={`Expected pace: ${Math.round(paceMarker)}%`}
        />
      )}
    </div>
  );
}

function calcPace(utilization, resetsAt, windowMs) {
  if (!resetsAt || !windowMs) return null;
  const now = Date.now();
  const resetMs = new Date(resetsAt).getTime();
  const timeRemainingMs = Math.max(0, resetMs - now);
  const timeElapsedPct = ((windowMs - timeRemainingMs) / windowMs) * 100;
  const timeRemainingPct = 100 - timeElapsedPct;
  if (timeElapsedPct <= 0) return null;
  // pace = ratio of usage rate vs time rate. >1 means burning faster than sustainable
  const pace = utilization / timeElapsedPct;
  return { pace, timeElapsedPct, timeRemainingPct };
}

function paceLabel(pace) {
  if (pace <= 0.5) return { text: "well under", color: GREEN };
  if (pace <= 0.8) return { text: "on track", color: GREEN };
  if (pace <= 1.0) return { text: "on pace", color: AMBER };
  if (pace <= 1.3) return { text: "above pace", color: AMBER };
  if (pace <= 1.8) return { text: "high pace", color: RED };
  return { text: "very high", color: RED };
}

function UsageRow({ label, utilization, resetsAt, mode, windowMs }) {
  const displayValue = mode === "remaining" ? 100 - utilization : utilization;
  const colors = getBarColor(displayValue, mode);
  const { timeStr } = formatTimeLeft(resetsAt);
  const resetTime = formatResetTime(resetsAt);
  const suffix = mode === "remaining" ? "left" : "used";

  const paceInfo = calcPace(utilization, resetsAt, windowMs);
  // In "remaining" mode, marker = time remaining %. In "used" mode, marker = time elapsed %.
  const paceMarker = paceInfo
    ? (mode === "remaining" ? paceInfo.timeRemainingPct : paceInfo.timeElapsedPct)
    : null;
  const paceData = paceInfo ? paceLabel(paceInfo.pace) : null;

  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "6px" }}>
        <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase", color: TEXT_DIM }}>
          {label}
        </span>
        <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
          <span style={{ fontSize: "22px", fontWeight: 700, color: colors.bar, fontFamily: "Menlo, monospace" }}>
            {Math.round(displayValue)}
            <span style={{ fontSize: "12px", fontWeight: 400 }}>%</span>
          </span>
          <span style={{ fontSize: "9px", fontWeight: 500, color: TEXT_DIM, letterSpacing: "0.5px" }}>
            {suffix}
          </span>
        </div>
      </div>
      <UsageBar displayValue={displayValue} mode={mode} paceMarker={paceMarker} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "5px", fontSize: "10px", color: TEXT_DIM, fontFamily: "Menlo, monospace" }}>
        <span>resets {resetTime}</span>
        <span>{timeStr}</span>
      </div>
      {paceData && (
        <div style={{ textAlign: "center", marginTop: "3px", fontFamily: "Menlo, monospace" }}>
          <span style={{ color: paceData.color, fontSize: "9px", fontWeight: 600, letterSpacing: "0.5px" }}>
            {paceData.text} ({paceInfo.pace.toFixed(1)}x)
          </span>
        </div>
      )}
    </div>
  );
}

const errorMessages = {
  no_credentials: {
    title: "No credentials found",
    detail: "Claude Code keychain entry missing.",
    action: "Run: claude auth login",
    showReauth: true,
  },
  parse_error: {
    title: "Credential parse error",
    detail: "Could not read OAuth token from keychain.",
    action: "Run: claude auth login",
    showReauth: true,
  },
  token_expired: {
    title: "Token expired",
    detail: "OAuth token has expired.",
    action: "Click to re-authenticate",
    showReauth: true,
  },
  auth_failed: {
    title: "Authentication failed",
    detail: "API rejected the token (401/403).",
    action: "Click to re-authenticate",
    showReauth: true,
  },
  rate_limited: {
    title: "Rate limited",
    detail: "Usage API throttled. Backing off before retry.",
    action: null,
    showReauth: false,
  },
  rate_limited_backoff: {
    title: "Rate limited",
    detail: null,
    action: null,
    showReauth: false,
  },
  network_error: {
    title: "Network error",
    detail: "Could not reach Anthropic API.",
    action: null,
    showReauth: false,
  },
  api_error: {
    title: "API error",
    detail: null,
    action: null,
    showReauth: false,
  },
};

function ErrorDisplay({ errorType, httpCode, retryIn, dispatch }) {
  const info = errorMessages[errorType] || {
    title: "Unknown error",
    detail: errorType,
    action: null,
    showReauth: false,
  };

  let detail = info.detail || `HTTP ${httpCode || "unknown"}`;
  if (retryIn && (errorType === "rate_limited" || errorType === "rate_limited_backoff")) {
    const mins = Math.ceil(retryIn / 60);
    detail = `Usage API throttled. Retrying in ~${mins}min.`;
  }

  return (
    <div
      style={{
        background: BG,
        border: `1px solid ${info.showReauth ? RED_DIM : AMBER_DIM}`,
        borderRadius: "10px",
        padding: "14px 16px",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "10px",
          paddingBottom: "8px",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: info.showReauth ? RED : AMBER,
              boxShadow: `0 0 4px ${info.showReauth ? "#e0404080" : AMBER_GLOW}`,
            }}
          />
          <span style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase", color: TEXT_DIM }}>
            {errorType === "rate_limited" ? "waiting" : "offline"}
          </span>
        </div>
        <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", color: AMBER }}>
          Claude Code Meter
        </span>
      </div>

      {/* Error info */}
      <div style={{ color: info.showReauth ? RED : AMBER, fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
        {info.title}
      </div>
      <div style={{ color: TEXT_DIM, fontSize: "10px", marginBottom: info.showReauth ? "10px" : "0" }}>
        {detail}
      </div>

      {/* Re-auth button */}
      {info.showReauth && (
        <div
          onClick={() => {
            dispatch({ type: "REAUTH" });
            run(
              "$HOME/.local/bin/claude auth login 2>/dev/null || /usr/local/bin/claude auth login 2>/dev/null || /opt/homebrew/bin/claude auth login 2>/dev/null"
            );
          }}
          style={{
            marginTop: "8px",
            padding: "6px 10px",
            borderRadius: "5px",
            border: `1px solid ${AMBER_DIM}`,
            backgroundColor: "rgba(232, 160, 32, 0.1)",
            color: AMBER,
            fontSize: "10px",
            fontWeight: 600,
            textAlign: "center",
            cursor: "pointer",
            letterSpacing: "0.5px",
            transition: "background-color 0.2s ease",
          }}
          onMouseEnter={(e) => { e.target.style.backgroundColor = "rgba(232, 160, 32, 0.2)"; }}
          onMouseLeave={(e) => { e.target.style.backgroundColor = "rgba(232, 160, 32, 0.1)"; }}
        >
          {info.action}
        </div>
      )}
    </div>
  );
}

export const className = {
  bottom: "20px",
  right: "20px",
  width: "280px",
  zIndex: 1,
};

export const render = ({ output, error, mode, reauthing }, dispatch) => {
  if (error) {
    return <ErrorDisplay errorType="network_error" dispatch={dispatch} />;
  }

  if (reauthing) {
    return (
      <div
        style={{
          background: BG,
          border: `1px solid ${AMBER_DIM}`,
          borderRadius: "10px",
          padding: "14px 16px",
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", color: AMBER }}>
            Claude Code Meter
          </span>
        </div>
        <div style={{ color: AMBER, fontSize: "11px", textAlign: "center", marginTop: "10px" }}>
          Waiting for authentication...
        </div>
        <div style={{ color: TEXT_DIM, fontSize: "10px", textAlign: "center", marginTop: "4px" }}>
          Complete login in your browser
        </div>
      </div>
    );
  }

  let data;
  try {
    data = JSON.parse(output);
  } catch {
    return (
      <div style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: "10px", padding: "16px", color: TEXT_DIM, fontFamily: "-apple-system, sans-serif", fontSize: "12px" }}>
        Loading...
      </div>
    );
  }

  if (data._widgetError) {
    return <ErrorDisplay errorType={data._widgetError} httpCode={data._httpCode} retryIn={data._retryIn} dispatch={dispatch} />;
  }

  if (data.error) {
    return <ErrorDisplay errorType="auth_failed" dispatch={dispatch} />;
  }

  const fiveHour = data.five_hour || { utilization: 0, resets_at: null };
  const sevenDay = data.seven_day || { utilization: 0, resets_at: null };
  const modeLabel = mode === "remaining" ? "remaining" : "used";
  const isStale = !!data._stale;

  return (
    <div
      style={{
        background: BG,
        border: `1px solid ${BORDER}`,
        borderRadius: "10px",
        padding: "14px 16px 10px",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        color: AMBER,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "14px",
          paddingBottom: "8px",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: isStale ? AMBER : "#40c040",
              boxShadow: `0 0 4px ${isStale ? AMBER_GLOW : "#40c04080"}`,
            }}
          />
          <span style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase", color: TEXT_DIM }}>
            {isStale ? "cached" : "live"}
          </span>
        </div>
        <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", color: AMBER }}>
          Claude Code Meter
        </span>
        <span
          onClick={() => dispatch({ type: "TOGGLE_MODE" })}
          style={{
            fontSize: "8px",
            fontWeight: 600,
            letterSpacing: "1px",
            textTransform: "uppercase",
            color: BG,
            backgroundColor: TEXT_DIM,
            padding: "2px 5px",
            borderRadius: "3px",
            cursor: "pointer",
            userSelect: "none",
            transition: "background-color 0.2s ease",
          }}
          onMouseEnter={(e) => { e.target.style.backgroundColor = AMBER; }}
          onMouseLeave={(e) => { e.target.style.backgroundColor = TEXT_DIM; }}
          title={`Click to switch to "${mode === "remaining" ? "used" : "remaining"}" mode`}
        >
          {modeLabel}
        </span>
      </div>

      {/* 5-hour session */}
      <UsageRow label="5-hour window" utilization={fiveHour.utilization} resetsAt={fiveHour.resets_at} mode={mode} windowMs={WINDOW_5H_MS} />

      {/* Divider */}
      <div style={{ borderTop: `1px solid ${BORDER}`, margin: "4px 0 12px" }} />

      {/* 7-day session */}
      <UsageRow label="7-day window" utilization={sevenDay.utilization} resetsAt={sevenDay.resets_at} mode={mode} windowMs={WINDOW_7D_MS} />
    </div>
  );
};
