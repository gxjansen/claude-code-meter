// Claude Code Meter - Übersicht Widget
// Shows 5-hour and 7-day session usage with reset timers
// Click the mode badge in the header to toggle between "remaining" and "used"

// ── SETTINGS ────────────────────────────────────────────
const DEFAULT_MODE = "remaining"; // "remaining" or "used"
const REFRESH_MS = 30000;         // 30 seconds
// ─────────────────────────────────────────────────────────

export const refreshFrequency = REFRESH_MS;

export const command = `
  TOKEN=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['claudeAiOauth']['accessToken'])" 2>/dev/null) && \
  curl -sf https://api.anthropic.com/api/oauth/usage \
    -H "Authorization: Bearer $TOKEN" \
    -H "anthropic-beta: oauth-2025-04-20" \
    -H "Content-Type: application/json" 2>/dev/null || echo '{"error": true}'
`;

export const initialState = { mode: DEFAULT_MODE };

export const updateState = (event, previousState) => {
  if (event.type === "TOGGLE_MODE") {
    return {
      ...previousState,
      mode: previousState.mode === "remaining" ? "used" : "remaining",
    };
  }
  if (event.type === "UB/COMMAND_RAN") {
    return { ...previousState, output: event.output, error: event.error };
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

function UsageBar({ displayValue, mode, segments = 20 }) {
  const filled = Math.round((displayValue / 100) * segments);
  const colors = getBarColor(displayValue, mode);
  return (
    <div style={{ display: "flex", gap: "2px", alignItems: "center" }}>
      {Array.from({ length: segments }, (_, i) => (
        <div
          key={i}
          style={{
            width: "8px",
            height: "18px",
            borderRadius: "1px",
            backgroundColor: i < filled ? colors.bar : colors.dim,
            boxShadow: i < filled ? `0 0 4px ${colors.glow}` : "none",
            transition: "background-color 0.3s ease",
          }}
        />
      ))}
    </div>
  );
}

function UsageRow({ label, utilization, resetsAt, mode }) {
  const displayValue = mode === "remaining" ? 100 - utilization : utilization;
  const colors = getBarColor(displayValue, mode);
  const { timeStr } = formatTimeLeft(resetsAt);
  const resetTime = formatResetTime(resetsAt);
  const suffix = mode === "remaining" ? "left" : "used";
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
      <UsageBar displayValue={displayValue} mode={mode} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "5px", fontSize: "10px", color: TEXT_DIM, fontFamily: "Menlo, monospace" }}>
        <span>resets {resetTime}</span>
        <span>{timeStr}</span>
      </div>
    </div>
  );
}

export const className = `
  bottom: "20px",
  right: "20px",
  width: "280px",
  zIndex: 1,
`;

export const render = ({ output, error, mode }, dispatch) => {
  if (error) {
    return (
      <div style={{ background: BG, border: `1px solid ${RED_DIM}`, borderRadius: "10px", padding: "16px", color: RED, fontFamily: "-apple-system, sans-serif", fontSize: "12px" }}>
        Error fetching usage data
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

  if (data.error) {
    return (
      <div style={{ background: BG, border: `1px solid ${RED_DIM}`, borderRadius: "10px", padding: "16px", color: RED, fontFamily: "-apple-system, sans-serif", fontSize: "12px" }}>
        Auth failed - check Claude Code credentials
      </div>
    );
  }

  const fiveHour = data.five_hour || { utilization: 0, resets_at: null };
  const sevenDay = data.seven_day || { utilization: 0, resets_at: null };
  const modeLabel = mode === "remaining" ? "remaining" : "used";

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
              backgroundColor: "#40c040",
              boxShadow: "0 0 4px #40c04080",
            }}
          />
          <span style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase", color: TEXT_DIM }}>
            live
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
      <UsageRow label="5-hour window" utilization={fiveHour.utilization} resetsAt={fiveHour.resets_at} mode={mode} />

      {/* Divider */}
      <div style={{ borderTop: `1px solid ${BORDER}`, margin: "4px 0 12px" }} />

      {/* 7-day session */}
      <UsageRow label="7-day window" utilization={sevenDay.utilization} resetsAt={sevenDay.resets_at} mode={mode} />
    </div>
  );
};
