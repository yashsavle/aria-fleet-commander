import { useState, useEffect, useRef, useCallback } from "react";

// ─── Config ────────────────────────────────────────────────────────────────
const ROS_WS_URL   = import.meta.env.VITE_WS_URL   || "ws://35.236.17.72:9090";
const API_BASE_URL = import.meta.env.VITE_API_URL  || "http://localhost:8000";

// ─── Palette ───────────────────────────────────────────────────────────────
const C = {
  bg:      "#070b14",
  panel:   "#0c1220",
  border:  "#1a2640",
  accent:  "#00c8ff",
  green:   "#00ff9d",
  warn:    "#ffb800",
  danger:  "#ff3d5a",
  purple:  "#a855f7",
  text:    "#dde6f8",
  muted:   "#3d5070",
  white:   "#ffffff",
};

// ─── Warehouse layout (matches Gazebo world) ──────────────────────────────
// Gazebo coords range roughly -2 to +5 in X and Y
// We map that to SVG 0-100 viewbox
const toSVG = (x, y) => ({
  sx: Math.max(2, Math.min(98, ((x + 3) / 10) * 100)),
  sy: Math.max(2, Math.min(98, 98 - ((y + 3) / 10) * 100)),
});

const WAYPOINTS = {
  agv_01: [{ x: 2.0, y: 0.0 }, { x: 2.0, y: 2.0 }, { x: 0.0, y: 2.0 }, { x: 0.0, y: 0.0 }],
  agv_02: [{ x: 4.0, y: 0.0 }, { x: 4.0, y: 2.0 }, { x: 2.0, y: 2.0 }, { x: 2.0, y: 0.0 }],
  agv_03: [{ x: 0.0, y: 2.0 }, { x: 2.0, y: 2.0 }, { x: 4.0, y: 0.0 }, { x: 0.0, y: 0.0 }],
  agv_04: [{ x: 1.0, y: 1.0 }, { x: 3.0, y: 1.0 }, { x: 3.0, y: 3.0 }, { x: 1.0, y: 3.0 }],
  agv_05: [{ x: 2.0, y: 3.0 }, { x: 4.0, y: 3.0 }, { x: 4.0, y: 1.0 }, { x: 0.0, y: 1.0 }],
  agv_06: [{ x: 0.0, y: 3.0 }, { x: 2.0, y: 0.0 }, { x: 4.0, y: 3.0 }, { x: 2.0, y: 3.0 }],
};

const DOCK_POSITIONS = [
  { name: "Dock 1", x: -1.5, y: -1.5 },
  { name: "Dock 2", x:  2.0, y: -1.5 },
  { name: "Dock 3", x:  5.0, y: -1.5 },
  { name: "Charge", x:  5.5, y:  3.0 },
];

const ZONE_LABELS = [
  { name: "Zone A\nAuto Parts",    x: -0.5, y: 4.0 },
  { name: "Zone B\nElectronics",   x:  2.0, y: 4.0 },
  { name: "Zone C\nRaw Material",  x:  4.5, y: 4.0 },
];

const FAULTS_STATIC = [
  { id: "F001", robot: "AGV-03", time: "auto", code: "ENC_ERR_04",    severity: "critical", msg: "Motor encoder feedback lost on drive wheel #2" },
  { id: "F002", robot: "AGV-02", time: "auto", code: "BATT_LOW",      severity: "warning",  msg: "Battery below 20% threshold — schedule charge" },
];

// ─── ROS Bridge Hook ──────────────────────────────────────────────────────
function useRosBridge(url) {
  const [robots, setRobots]     = useState({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Subscribe to fleet telemetry topic
      ws.send(JSON.stringify({
        op: "subscribe",
        topic: "/aria/telemetry",
        type: "std_msgs/String",
      }));
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.op === "publish" && msg.topic === "/aria/telemetry") {
          const fleet = JSON.parse(msg.msg.data);
          setRobots(fleet);
        }
      } catch (_) {}
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Publish mission via rosbridge
  const publishMission = useCallback((mission) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        op:    "publish",
        topic: "/aria/mission",
        msg:   { data: JSON.stringify(mission) },
      }));
      return true;
    }
    return false;
  }, []);

  return { robots, connected, publishMission };
}

// ─── Sub-components ───────────────────────────────────────────────────────
function StatusPill({ status }) {
  const map = {
    active:   { bg: "#003d2a", color: C.green,  label: "ACTIVE"   },
    idle:     { bg: "#1a2030", color: C.muted,  label: "IDLE"     },
    fault:    { bg: "#3d0010", color: C.danger, label: "FAULT"    },
    charging: { bg: "#2a1a00", color: C.warn,   label: "CHARGING" },
  };
  const s = map[status] || map.idle;
  return (
    <span style={{
      padding: "2px 10px", borderRadius: 20, fontSize: 10,
      fontWeight: 800, letterSpacing: "0.08em",
      background: s.bg, color: s.color,
    }}>{s.label}</span>
  );
}

function BattBar({ pct }) {
  const color = pct > 50 ? C.green : pct > 20 ? C.warn : C.danger;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: C.border, borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 1s" }} />
      </div>
      <span style={{ fontSize: 11, color, minWidth: 32, textAlign: "right" }}>{Math.round(pct)}%</span>
    </div>
  );
}

function KPICard({ label, value, unit, color, sub }) {
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "14px 16px",
    }}>
      <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 900, color: color || C.accent, letterSpacing: "-0.02em", lineHeight: 1 }}>
        {value}
        <span style={{ fontSize: 12, fontWeight: 400, color: C.muted, marginLeft: 4 }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─── Warehouse Map ────────────────────────────────────────────────────────
function WarehouseMap({ robots, selectedRobot, onSelect, showPaths }) {
  const robotList = Object.entries(robots).map(([id, r]) => ({ id, ...r }));

  return (
    <div style={{
      position: "relative", width: "100%", paddingTop: "65%",
      background: "#050810", borderRadius: 12,
      border: `1px solid ${C.border}`, overflow: "hidden",
    }}>
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        viewBox="0 0 100 65"
      >
        {/* Grid */}
        {Array.from({ length: 21 }).map((_, i) => (
          <line key={`v${i}`} x1={i * 5} y1={0} x2={i * 5} y2={65} stroke="#0d1828" strokeWidth="0.3" />
        ))}
        {Array.from({ length: 14 }).map((_, i) => (
          <line key={`h${i}`} x1={0} y1={i * 5} x2={100} y2={i * 5} stroke="#0d1828" strokeWidth="0.3" />
        ))}

        {/* Zone labels */}
        {ZONE_LABELS.map((z, i) => {
          const { sx, sy } = toSVG(z.x, z.y);
          return (
            <g key={i}>
              <rect x={sx - 8} y={sy - 5} width={16} height={9} rx="1" fill="#0a1828" stroke="#1a3050" strokeWidth="0.4" />
              {z.name.split("\n").map((line, j) => (
                <text key={j} x={sx} y={sy - 1.5 + j * 3.5} textAnchor="middle" fill="#1e4a7a" fontSize="2.2" fontFamily="monospace">{line}</text>
              ))}
            </g>
          );
        })}

        {/* Docks */}
        {DOCK_POSITIONS.map((d, i) => {
          const { sx, sy } = toSVG(d.x, d.y);
          const isCharge = d.name === "Charge";
          return (
            <g key={i}>
              <rect x={sx - 5} y={sy - 3} width={10} height={6} rx="0.8"
                fill={isCharge ? "#1a1200" : "#0a1828"}
                stroke={isCharge ? C.warn : C.accent} strokeWidth="0.5" />
              <text x={sx} y={sy + 1} textAnchor="middle"
                fill={isCharge ? C.warn : C.accent} fontSize="2.2" fontFamily="monospace">
                {d.name}
              </text>
            </g>
          );
        })}

        {/* Intended paths */}
        {showPaths && robotList.map((r) => {
          const wps = WAYPOINTS[r.id];
          if (!wps || r.status !== "active") return null;
          const points = wps.map(p => {
            const { sx, sy } = toSVG(p.x, p.y);
            return `${sx},${sy}`;
          }).join(" ");
          const color = C.accent;
          return (
            <polyline key={`path-${r.id}`}
              points={points}
              fill="none"
              stroke={color}
              strokeWidth="0.6"
              strokeDasharray="2,2"
              opacity="0.35"
            />
          );
        })}

        {/* Waypoint dots */}
        {showPaths && robotList.map((r) => {
          const wps = WAYPOINTS[r.id];
          if (!wps || r.status !== "active") return null;
          return wps.map((p, i) => {
            const { sx, sy } = toSVG(p.x, p.y);
            return (
              <circle key={`wp-${r.id}-${i}`}
                cx={sx} cy={sy} r={0.8}
                fill={C.accent} opacity={0.4} />
            );
          });
        })}

        {/* Robots */}
        {robotList.map((r) => {
          const rx = r.x ?? 0;
          const ry = r.y ?? 0;
          const { sx, sy } = toSVG(rx, ry);
          const isSelected = selectedRobot?.id === r.id;
          const color =
            r.status === "active"   ? C.green  :
            r.status === "fault"    ? C.danger :
            r.status === "charging" ? C.warn   : C.muted;

          return (
            <g key={r.id} onClick={() => onSelect(r)} style={{ cursor: "pointer" }}>
              {/* Selection ring */}
              {isSelected && (
                <circle cx={sx} cy={sy} r={4.5}
                  fill="none" stroke={color} strokeWidth="0.5" opacity={0.6} />
              )}
              {/* Pulse ring for active */}
              {r.status === "active" && (
                <circle cx={sx} cy={sy} r={3.5}
                  fill="none" stroke={color} strokeWidth="0.3" opacity={0.25} />
              )}
              {/* Robot body */}
              <circle cx={sx} cy={sy} r={2.2} fill={color} opacity={0.9} />
              <circle cx={sx} cy={sy} r={1.1} fill="#000" />
              {/* Fault icon */}
              {r.status === "fault" && (
                <text x={sx + 2.8} y={sy - 2} fill={C.danger} fontSize="3.5">⚠</text>
              )}
              {/* Label */}
              <text x={sx} y={sy + 4.8} textAnchor="middle"
                fill={color} fontSize="2" fontFamily="monospace" fontWeight="bold">
                {r.id.replace("agv_0", "AGV-")}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── AI Chat ──────────────────────────────────────────────────────────────
function AIChat({ faults, robots }) {
  const [messages, setMessages] = useState([{
    role: "aria",
    text: "Hi! I'm ARIA, your fleet AI assistant.\n\nAsk me about:\n• Any active fault codes\n• Maintenance procedures\n• Route optimization\n• Fleet performance analysis",
  }]);
  const [input, setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const q = input.trim();
    setInput("");
    setMessages(m => [...m, { role: "user", text: q }]);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/ask-aria`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, context: { faults, robots } }),
      });
      const data = await res.json();
      setMessages(m => [...m, { role: "aria", text: data.response }]);
    } catch {
      setMessages(m => [...m, {
        role: "aria",
        text: "⚠ Backend not reachable. Make sure uvicorn is running on port 8000.",
      }]);
    }
    setLoading(false);
  };

  const renderText = (text) =>
    text.split("\n").map((line, i) => {
      if (line.startsWith("**") && line.endsWith("**"))
        return <div key={i} style={{ color: C.accent, fontWeight: 700, marginTop: 8, marginBottom: 2, fontSize: 12 }}>{line.replace(/\*\*/g, "")}</div>;
      if (line.startsWith("•"))
        return <div key={i} style={{ paddingLeft: 12, color: C.text, fontSize: 12, marginBottom: 2 }}>{line}</div>;
      if (/^\d\./.test(line))
        return <div key={i} style={{ paddingLeft: 12, color: C.green, fontSize: 12, marginBottom: 2 }}>{line}</div>;
      return <div key={i} style={{ color: C.text, fontSize: 12, marginBottom: line ? 2 : 4 }}>{line}</div>;
    });

  const suggestions = ["Explain AGV-03 fault", "Fix ENC_ERR_04 step by step", "Which robots need maintenance?", "Optimize fleet for 40 units/hr"];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
              background: m.role === "aria" ? `linear-gradient(135deg, ${C.accent}, ${C.purple})` : C.border,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 800, color: "#fff",
            }}>
              {m.role === "aria" ? "AI" : "U"}
            </div>
            <div style={{
              background: m.role === "aria" ? "#0d1828" : "#111827",
              border: `1px solid ${m.role === "aria" ? "#1a3050" : C.border}`,
              borderRadius: 10, padding: "10px 14px", flex: 1, lineHeight: 1.7,
            }}>
              {renderText(m.text)}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: `linear-gradient(135deg, ${C.accent}, ${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff" }}>AI</div>
            <div style={{ color: C.muted, fontSize: 13 }}>ARIA is analyzing...</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div style={{ padding: 12, borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {suggestions.map(s => (
            <button key={s} onClick={() => setInput(s)} style={{
              background: "transparent", border: `1px solid ${C.border}`,
              borderRadius: 6, padding: "3px 10px", color: C.muted,
              fontSize: 11, cursor: "pointer",
            }}>{s}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
            placeholder="Ask ARIA about faults, maintenance, routing..."
            style={{
              flex: 1, background: "#050810", border: `1px solid ${C.border}`,
              borderRadius: 8, padding: "10px 14px", color: C.text,
              fontSize: 13, outline: "none", fontFamily: "monospace",
            }}
          />
          <button onClick={send} disabled={loading} style={{
            background: loading ? C.muted : `linear-gradient(135deg, ${C.accent}, ${C.purple})`,
            border: "none", borderRadius: 8, padding: "10px 20px",
            color: "#fff", fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
          }}>Send</button>
        </div>
      </div>
    </div>
  );
}

// ─── Mission Modal ────────────────────────────────────────────────────────
function MissionModal({ onClose, onDispatch, rosConnected }) {
  const [form, setForm] = useState({
    hourly_target: "",
    material_type: "",
    weight_kg: "",
    source: "Zone A",
    dock: "Dock 1",
  });
  const [dispatching, setDispatching] = useState(false);
  const [result, setResult]           = useState(null);

  const robotsNeeded = Math.max(1, Math.min(6,
    Math.ceil((parseInt(form.hourly_target) || 30) / 15)
  ));

  const dispatch = async () => {
    setDispatching(true);
    const mission = {
      hourly_target: parseInt(form.hourly_target) || 30,
      material_type: form.material_type || "General",
      weight_kg:     parseFloat(form.weight_kg) || 25,
      source:        form.source,
      dock:          form.dock,
      robots:        robotsNeeded,
    };

    // Send to backend (which forwards to rosbridge)
    try {
      const res = await fetch(`${API_BASE_URL}/dispatch-mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mission),
      });
      const data = await res.json();
      setResult({ success: true, robots: data.robots });
    } catch {
      // Fallback: publish directly via rosbridge if backend is down
      const published = onDispatch(mission);
      if (published) {
        setResult({ success: true, robots: Array.from({ length: robotsNeeded }, (_, i) => `AGV-0${i + 1}`) });
      } else {
        setResult({ success: false });
      }
    }
    setDispatching(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
    }}>
      <div style={{
        background: C.panel, border: `1px solid ${C.accent}`,
        borderRadius: 16, padding: 28, width: 440,
        boxShadow: `0 0 40px ${C.accent}22`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.accent }}>+ Dispatch New Mission</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        {result ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            {result.success ? (
              <>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🚀</div>
                <div style={{ color: C.green, fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Mission Dispatched!</div>
                <div style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>
                  Activated: {result.robots?.join(", ")}
                </div>
                <div style={{ color: C.text, fontSize: 12 }}>
                  Robots are now moving in Gazebo simulation
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
                <div style={{ color: C.danger, fontSize: 14, marginBottom: 8 }}>Connection Failed</div>
                <div style={{ color: C.muted, fontSize: 12 }}>Make sure backend and rosbridge are running</div>
              </>
            )}
            <button onClick={onClose} style={{
              marginTop: 20, background: C.border, border: "none",
              borderRadius: 8, padding: "10px 24px", color: C.text,
              fontSize: 13, cursor: "pointer",
            }}>Close</button>
          </div>
        ) : (
          <>
            {!rosConnected && (
              <div style={{
                background: "#2a1000", border: `1px solid ${C.warn}`,
                borderRadius: 8, padding: "8px 12px", marginBottom: 16,
                fontSize: 12, color: C.warn,
              }}>
                ⚠ ROS not connected — mission will queue until connection restored
              </div>
            )}

            {/* Auto robot count preview */}
            <div style={{
              background: "#0a1828", border: `1px solid ${C.border}`,
              borderRadius: 8, padding: "10px 14px", marginBottom: 16,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: 12, color: C.muted }}>Robots to dispatch:</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: C.green }}>{robotsNeeded} AGVs</span>
            </div>

            {[
              ["hourly_target", "Hourly Target (units/hr)", "e.g. 40", "number"],
              ["material_type", "Material Type",            "e.g. Auto Parts, Electronics", "text"],
              ["weight_kg",     "Weight per Unit (kg)",     "e.g. 25", "number"],
            ].map(([field, label, ph, type]) => (
              <div key={field} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>{label}</div>
                <input
                  type={type}
                  placeholder={ph}
                  value={form[field]}
                  onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  style={{
                    width: "100%", background: "#050810",
                    border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: "10px 14px", color: C.text,
                    fontSize: 13, outline: "none", fontFamily: "monospace",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            ))}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {[
                ["source", "Source Zone",       ["Zone A", "Zone B", "Zone C", "Zone D"]],
                ["dock",   "Destination Dock",  ["Dock 1", "Dock 2", "Dock 3", "Dock 4"]],
              ].map(([field, label, options]) => (
                <div key={field}>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>{label}</div>
                  <select
                    value={form[field]}
                    onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                    style={{
                      width: "100%", background: "#050810",
                      border: `1px solid ${C.border}`, borderRadius: 8,
                      padding: "10px 14px", color: C.text,
                      fontSize: 13, outline: "none", cursor: "pointer",
                    }}
                  >
                    {options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <button
              onClick={dispatch}
              disabled={dispatching}
              style={{
                width: "100%",
                background: dispatching ? C.muted : `linear-gradient(135deg, ${C.green}, ${C.accent})`,
                border: "none", borderRadius: 10, padding: 14,
                color: "#000", fontSize: 14, fontWeight: 800,
                cursor: dispatching ? "not-allowed" : "pointer",
                letterSpacing: "0.05em",
              }}
            >
              {dispatching ? "⏳ DISPATCHING..." : `🚀 DISPATCH ${robotsNeeded} ROBOTS`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────
export default function ARIADashboard() {
  const { robots, connected, publishMission } = useRosBridge(ROS_WS_URL);
  const [selectedRobot, setSelectedRobot] = useState(null);
  const [activeTab, setActiveTab]         = useState("fleet");
  const [showModal, setShowModal]         = useState(false);
  const [showPaths, setShowPaths]         = useState(true);
  const [time, setTime]                   = useState(new Date());
  const [faults, setFaults]               = useState(FAULTS_STATIC);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-detect faults from live robot data
  useEffect(() => {
    const liveFaults = Object.entries(robots)
      .filter(([, r]) => r.status === "fault" && r.fault)
      .map(([id, r]) => ({
        id:       id,
        robot:    id.replace("agv_0", "AGV-"),
        time:     new Date().toLocaleTimeString(),
        code:     r.fault,
        severity: "critical",
        msg:      `Live fault detected: ${r.fault}`,
      }));

    if (liveFaults.length > 0) {
      setFaults(prev => {
        const existing = new Set(prev.map(f => f.id));
        const newFaults = liveFaults.filter(f => !existing.has(f.id));
        return [...prev, ...newFaults];
      });
    }
  }, [robots]);

  const robotList = Object.entries(robots).map(([id, r]) => ({ id, ...r }));
  const activeCount   = robotList.filter(r => r.status === "active").length;
  const faultCount    = robotList.filter(r => r.status === "fault").length  || faults.filter(f => f.severity === "critical").length;
  const idleCount     = robotList.filter(r => r.status === "idle").length;
  const avgBattery    = robotList.length > 0
    ? Math.round(robotList.reduce((s, r) => s + (r.battery || 100), 0) / robotList.length)
    : 100;

  const tabs = [
    { id: "fleet",  label: "Fleet Map" },
    { id: "robots", label: "Robots" },
    { id: "alerts", label: `Alerts${faultCount > 0 ? ` (${faultCount})` : ""}`, alert: faultCount > 0 },
    { id: "aria",   label: "ARIA AI" },
    { id: "docks",  label: "Docks" },
  ];

  return (
    <div style={{
      background: C.bg, minHeight: "100vh",
      fontFamily: "'Courier New', monospace", color: C.text,
      padding: 20,
    }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
        select option { background: #0c1220; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes pulse-ring { 0%{transform:scale(1);opacity:0.6} 100%{transform:scale(1.5);opacity:0} }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 12,
            background: `linear-gradient(135deg, ${C.accent}, ${C.purple})`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
          }}>🤖</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.02em", color: C.white }}>
              ARIA <span style={{ color: C.accent }}>Fleet Commander</span>
            </div>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
              Autonomous Robotics Intelligence & Administration
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* ROS Connection status */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 8,
            background: connected ? "#003d2a" : "#2a0a10",
            border: `1px solid ${connected ? C.green : C.danger}`,
            fontSize: 12, fontWeight: 700,
            color: connected ? C.green : C.danger,
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: connected ? C.green : C.danger,
              animation: connected ? "none" : "blink 1s infinite",
            }} />
            {connected ? "ROS LIVE" : "ROS OFFLINE"}
          </div>

          {faultCount > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 8,
              background: "#2a0010", border: `1px solid ${C.danger}`,
              fontSize: 12, fontWeight: 700, color: C.danger,
              animation: "blink 1.5s infinite",
            }}>
              ⚠ {faultCount} FAULT{faultCount > 1 ? "S" : ""}
            </div>
          )}

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.accent, letterSpacing: "0.05em" }}>
              {time.toLocaleTimeString()}
            </div>
            <div style={{ fontSize: 10, color: C.muted }}>
              {time.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </div>
          </div>

          <button onClick={() => setShowModal(true)} style={{
            background: `linear-gradient(135deg, ${C.green}, ${C.accent})`,
            border: "none", borderRadius: 8, padding: "10px 20px",
            color: "#000", fontSize: 13, fontWeight: 800,
            cursor: "pointer", letterSpacing: "0.05em",
          }}>+ NEW MISSION</button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 20 }}>
        <KPICard label="Active AGVs"  value={activeCount}  unit={`/ ${robotList.length || 6}`} color={C.green}  sub="Running tasks" />
        <KPICard label="Faults"       value={faultCount}   unit="critical" color={faultCount > 0 ? C.danger : C.green} sub={faultCount > 0 ? "Needs attention" : "All clear"} />
        <KPICard label="Idle AGVs"    value={idleCount}    color={C.warn}  sub="Available" />
        <KPICard label="Avg Battery"  value={avgBattery}   unit="%"  color={avgBattery > 50 ? C.green : C.warn} sub="Fleet average" />
        <KPICard label="Throughput"   value="73"  unit="u/hr" color={C.accent} sub="Target: 65 u/hr" />
        <KPICard label="ROS Topics"   value={connected ? "LIVE" : "OFF"} color={connected ? C.green : C.danger} sub={connected ? "Telemetry streaming" : "Check rosbridge"} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16, borderBottom: `1px solid ${C.border}` }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            background: "transparent", border: "none",
            borderBottom: activeTab === t.id ? `2px solid ${t.alert ? C.danger : C.accent}` : "2px solid transparent",
            padding: "10px 20px", marginBottom: -1,
            color: activeTab === t.id ? (t.alert ? C.danger : C.accent) : C.muted,
            fontSize: 13, fontWeight: activeTab === t.id ? 700 : 400,
            cursor: "pointer", letterSpacing: "0.05em",
            animation: t.alert ? "blink 1.5s infinite" : "none",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Fleet Map Tab ── */}
      {activeTab === "fleet" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>
          <div style={{
            background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: 16,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Live Warehouse Floor — {connected ? `${robotList.length} robots online` : "Connecting to ROS..."}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.muted, cursor: "pointer" }}>
                <input type="checkbox" checked={showPaths} onChange={e => setShowPaths(e.target.checked)} />
                Show intended paths
              </label>
            </div>
            <WarehouseMap
              robots={robots}
              selectedRobot={selectedRobot}
              onSelect={setSelectedRobot}
              showPaths={showPaths}
            />
            <div style={{ display: "flex", gap: 20, marginTop: 10 }}>
              {[["active", C.green, "Active"], ["fault", C.danger, "Fault"], ["idle", C.muted, "Idle"], ["charging", C.warn, "Charging"]].map(([s, c, l]) => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.muted }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }} />{l}
                </div>
              ))}
              {showPaths && (
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.muted }}>
                  <span style={{ width: 12, height: 2, background: C.accent, display: "inline-block", opacity: 0.4 }} />Intended path
                </div>
              )}
            </div>
          </div>

          {/* Robot inspector */}
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>
              {selectedRobot ? `Inspecting ${selectedRobot.id}` : "Select a Robot"}
            </div>
            {selectedRobot ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20, fontWeight: 900, color: C.white }}>
                    {selectedRobot.id.replace("agv_0", "AGV-")}
                  </span>
                  <StatusPill status={selectedRobot.status} />
                </div>
                {[
                  ["Task",     selectedRobot.task || "Standby"],
                  ["Position", `X: ${(selectedRobot.x || 0).toFixed(2)}  Y: ${(selectedRobot.y || 0).toFixed(2)}`],
                  ["Fault",    selectedRobot.fault || "None"],
                ].map(([k, v]) => (
                  <div key={k} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 10 }}>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>{k}</div>
                    <div style={{ fontSize: 13, color: selectedRobot.status === "fault" && k === "Fault" ? C.danger : C.text }}>{v}</div>
                  </div>
                ))}
                <div>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 6 }}>Battery</div>
                  <BattBar pct={selectedRobot.battery ?? 100} />
                </div>
                {selectedRobot.status === "fault" && (
                  <button onClick={() => setActiveTab("aria")} style={{
                    background: `linear-gradient(135deg, ${C.accent}, ${C.purple})`,
                    border: "none", borderRadius: 8, padding: 10,
                    color: C.white, fontSize: 13, fontWeight: 700, cursor: "pointer",
                  }}>🤖 Ask ARIA for Fix</button>
                )}
              </div>
            ) : (
              <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: "40px 0" }}>
                Click any robot on the map<br />to inspect its status
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Robots Tab ── */}
      {activeTab === "robots" && (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Robot ID", "Status", "Battery", "Task", "Position", "Fault"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(robotList.length > 0 ? robotList : Object.entries({ agv_01: {}, agv_02: {}, agv_03: {}, agv_04: {}, agv_05: {}, agv_06: {} }).map(([id]) => ({ id, status: "idle", battery: 100, task: "Waiting for ROS...", x: 0, y: 0, fault: null }))).map((r, i) => (
                <tr key={r.id}
                  style={{ borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: i % 2 === 0 ? "transparent" : "#0a1020" }}
                  onClick={() => { setSelectedRobot(r); setActiveTab("fleet"); }}>
                  <td style={{ padding: "12px 16px", fontWeight: 700, color: C.white }}>{r.id?.replace("agv_0", "AGV-")}</td>
                  <td style={{ padding: "12px 16px" }}><StatusPill status={r.status || "idle"} /></td>
                  <td style={{ padding: "12px 16px", minWidth: 130 }}><BattBar pct={r.battery ?? 100} /></td>
                  <td style={{ padding: "12px 16px", color: r.status === "fault" ? C.danger : C.text, fontSize: 12 }}>{r.task || "Standby"}</td>
                  <td style={{ padding: "12px 16px", color: C.muted, fontSize: 12 }}>X:{(r.x || 0).toFixed(1)} Y:{(r.y || 0).toFixed(1)}</td>
                  <td style={{ padding: "12px 16px", color: r.fault ? C.danger : C.muted, fontSize: 12 }}>{r.fault || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Alerts Tab ── */}
      {activeTab === "alerts" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {faults.length === 0 ? (
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, textAlign: "center", color: C.green, fontSize: 16 }}>
              ✅ All systems nominal — no active faults
            </div>
          ) : faults.map(f => (
            <div key={f.id} style={{
              background: C.panel,
              border: `1px solid ${f.severity === "critical" ? C.danger : C.warn}`,
              borderRadius: 12, padding: 20,
              boxShadow: `0 0 20px ${f.severity === "critical" ? C.danger : C.warn}22`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div style={{ fontSize: 28 }}>{f.severity === "critical" ? "🚨" : "⚠️"}</div>
                  <div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 16, fontWeight: 800, color: f.severity === "critical" ? C.danger : C.warn }}>{f.robot}</span>
                      <StatusPill status="fault" />
                      <span style={{ fontSize: 11, color: C.muted, fontFamily: "monospace" }}>CODE: {f.code}</span>
                    </div>
                    <div style={{ color: C.text, fontSize: 14, marginBottom: 4 }}>{f.msg}</div>
                    <div style={{ color: C.muted, fontSize: 11 }}>Detected at {f.time}</div>
                  </div>
                </div>
                <button onClick={() => { setActiveTab("aria"); }} style={{
                  background: `linear-gradient(135deg, ${C.accent}, ${C.purple})`,
                  border: "none", borderRadius: 8, padding: "8px 16px",
                  color: C.white, fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}>🤖 Ask ARIA</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ARIA AI Tab ── */}
      {activeTab === "aria" && (
        <div style={{
          background: C.panel, border: `1px solid ${C.accent}`,
          borderRadius: 12, height: 520,
          display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: `0 0 30px ${C.accent}11`,
        }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: `linear-gradient(135deg, ${C.accent}, ${C.purple})`,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
            }}>🤖</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.accent }}>ARIA — Fleet Intelligence Agent</div>
              <div style={{ fontSize: 10, color: C.green }}>● Online · Powered by Groq / Claude</div>
            </div>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <AIChat faults={faults} robots={robots} />
          </div>
        </div>
      )}

      {/* ── Docks Tab ── */}
      {activeTab === "docks" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
          {[
            { name: "Dock 1", throughput: 24, target: 30, active: true },
            { name: "Dock 2", throughput: 18, target: 20, active: true },
            { name: "Dock 3", throughput: 31, target: 30, active: true },
            { name: "Dock 4", throughput: 0,  target: 15, active: false },
          ].map(d => {
            const pct   = Math.round((d.throughput / d.target) * 100);
            const color = pct >= 100 ? C.green : pct >= 70 ? C.accent : pct > 0 ? C.warn : C.muted;
            return (
              <div key={d.name} style={{
                background: C.panel,
                border: `1px solid ${d.active ? color : C.border}`,
                borderRadius: 12, padding: 20,
                boxShadow: d.active ? `0 0 20px ${color}11` : "none",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.white }}>{d.name}</div>
                  <StatusPill status={d.active ? "active" : "idle"} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Throughput</div>
                    <div style={{ fontSize: 34, fontWeight: 900, color, letterSpacing: "-0.02em" }}>
                      {d.throughput}<span style={{ fontSize: 14, color: C.muted, fontWeight: 400 }}> / {d.target}</span>
                    </div>
                    <div style={{ fontSize: 10, color: C.muted }}>units this hour</div>
                  </div>
                  <div style={{
                    width: 72, height: 72, borderRadius: "50%",
                    background: `conic-gradient(${color} ${pct * 3.6}deg, ${C.border} 0deg)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <div style={{ width: 52, height: 52, borderRadius: "50%", background: C.panel, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color }}>
                      {pct}%
                    </div>
                  </div>
                </div>
                <div style={{ height: 5, background: C.border, borderRadius: 3 }}>
                  <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.5s" }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Mission Modal */}
      {showModal && (
        <MissionModal
          onClose={() => setShowModal(false)}
          onDispatch={publishMission}
          rosConnected={connected}
        />
      )}
    </div>
  );
}
