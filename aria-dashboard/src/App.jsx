import { useState, useEffect, useRef, useCallback } from "react";

const ROS_WS_URL   = import.meta.env.VITE_WS_URL  || "ws://34.94.165.197:9090";
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// World is 20x20m. SVG viewBox: 400 wide x 220 tall (landscape, spacious)
const W = 400, H = 220;
const toSVG = (wx, wy) => ({
  sx: 8 + (wx / 20) * (W - 16),
  sy: 8 + (1 - wy / 20) * (H - 16),
});

const ZONE_PATHS = {
  "Zone A": [{ x:2.0,y:3.5 },{ x:2.0,y:14.5 },{ x:10.0,y:3.5 },{ x:2.0,y:3.5 }],
  "Zone B": [{ x:2.5,y:3.5 },{ x:10.0,y:14.5 },{ x:10.0,y:3.5 },{ x:2.5,y:3.5 }],
  "Zone C": [{ x:3.5,y:3.5 },{ x:18.0,y:14.5 },{ x:10.0,y:3.5 },{ x:3.5,y:3.5 }],
};

// ── ROS Bridge ────────────────────────────────────────────────────────────
function useRosBridge(url) {
  const [robots, setRobots]       = useState({});
  const [connected, setConnected] = useState(false);
  const ws  = useRef(null);
  const rec = useRef(null);

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return;
    const sock = new WebSocket(url);
    ws.current = sock;
    sock.onopen = () => {
      setConnected(true);
      sock.send(JSON.stringify({ op:"subscribe", topic:"/aria/telemetry", type:"std_msgs/String" }));
    };
    sock.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.op === "publish" && m.topic === "/aria/telemetry")
          setRobots(JSON.parse(m.msg.data));
      } catch(_) {}
    };
    sock.onclose = () => { setConnected(false); rec.current = setTimeout(connect, 3000); };
    sock.onerror = () => sock.close();
  }, [url]);

  useEffect(() => { connect(); return () => { clearTimeout(rec.current); ws.current?.close(); }; }, [connect]);

  const publish = useCallback((topic, data) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ op:"publish", topic, msg:{ data: JSON.stringify(data) } }));
      return true;
    }
    return false;
  }, []);

  return { robots, connected, publish };
}

// ── Status helpers ─────────────────────────────────────────────────────────
const statusColor = (s) =>
  s==="active"?"#00ff9d": s==="fault"?"#ff3d5a": s==="charging"?"#ffb800": "#3a4a6a";
const statusBg = (s) =>
  s==="active"?"#002a1a": s==="fault"?"#2a0010": s==="charging"?"#2a1800": "#0f1624";

// ── Warehouse Map SVG ─────────────────────────────────────────────────────
function WarehouseMap({ robots, selectedId, onSelect }) {
  const rl  = Object.entries(robots).map(([id,r]) => ({ id,...r }));
  const sel = rl.find(r => r.id === selectedId);

  const zones = [
    { name:"Zone A", label:"AUTO PARTS",   x:2,  color:"#ff4444" },
    { name:"Zone B", label:"ELECTRONICS",  x:10, color:"#22dd66" },
    { name:"Zone C", label:"RAW MATERIAL", x:18, color:"#ff9922" },
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:"100%", display:"block" }}
      preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="g" width="19.6" height="10.4" patternUnits="userSpaceOnUse">
          <path d="M19.6 0L0 0 0 10.4" fill="none" stroke="#0c1624" strokeWidth="0.4"/>
        </pattern>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="softglow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* BG */}
      <rect width={W} height={H} fill="#05090f"/>
      <rect width={W} height={H} fill="url(#g)"/>
      {/* Border */}
      <rect x={1} y={1} width={W-2} height={H-2} fill="none" stroke="#0d1a2e" strokeWidth="0.8"/>

      {/* Lane markings */}
      {[6.0, 8.0].map((y,i) => {
        const {sy} = toSVG(0,y);
        return <line key={i} x1={8} y1={sy} x2={W-8} y2={sy}
          stroke="#e6b800" strokeWidth="1.5" strokeDasharray="10,5" opacity={0.45}/>;
      })}

      {/* ── ZONES (top area) ── */}
      {zones.map(z => {
        const {sx,sy} = toSVG(z.x, 18.5);
        return (
          <g key={z.name}>
            {/* Rack shadow */}
            <rect x={sx-22} y={sy-6} width={44} height={13} rx="2"
              fill={z.color} opacity={0.06}/>
            {/* Rack body */}
            <rect x={sx-21} y={sy-7} width={42} height={13} rx="2"
              fill="#080e1c" stroke={z.color} strokeWidth="1.5" opacity={0.95}/>
            {/* Rack top stripe */}
            <rect x={sx-21} y={sy-7} width={42} height={3} rx="1.5" fill={z.color} opacity={0.55}/>
            {/* Shelf line */}
            <line x1={sx-19} y1={sy-1} x2={sx+19} y2={sy-1} stroke={z.color} strokeWidth="0.5" opacity={0.3}/>
            {/* Boxes on rack — 3 boxes */}
            {[-12, 0, 12].map((ox,i) => (
              <g key={i}>
                <rect x={sx+ox-5} y={sy-6} width={9} height={6} rx="1"
                  fill={z.color} opacity={0.8}/>
                <rect x={sx+ox-4} y={sy-5.5} width={7} height={2} rx="0.5"
                  fill="#fff" opacity={0.1}/>
              </g>
            ))}
            {/* Zone name */}
            <text x={sx} y={sy+9} textAnchor="middle"
              fill={z.color} fontSize="7" fontFamily="monospace" fontWeight="900" letterSpacing="0.5">
              {z.name}
            </text>
            <text x={sx} y={sy+15} textAnchor="middle"
              fill={z.color} fontSize="4" fontFamily="monospace" opacity={0.55}>
              {z.label}
            </text>

            {/* ── UR10 Arm ── */}
            {(() => {
              const {sx:ax, sy:ay} = toSVG(z.x, 14.2);
              return (
                <g filter="url(#softglow)">
                  {/* Floor mount */}
                  <rect x={ax-5} y={ay+2} width={10} height={4} rx="1"
                    fill="#111" stroke="#334" strokeWidth="0.8"/>
                  {/* Base cylinder */}
                  <ellipse cx={ax} cy={ay+2} rx={4} ry={2} fill="#1a1f3a" stroke="#3355cc" strokeWidth="0.8"/>
                  {/* Link 1 - shoulder to elbow */}
                  <line x1={ax} y1={ay+2} x2={ax-7} y2={ay-16}
                    stroke="#4466dd" strokeWidth="4" strokeLinecap="round"/>
                  {/* Link 1 highlight */}
                  <line x1={ax} y1={ay+2} x2={ax-7} y2={ay-16}
                    stroke="#6688ff" strokeWidth="1.5" strokeLinecap="round" opacity={0.5}/>
                  {/* Link 2 - elbow to wrist */}
                  <line x1={ax-7} y1={ay-16} x2={ax-3} y2={ay-32}
                    stroke="#3355cc" strokeWidth="3.5" strokeLinecap="round"/>
                  <line x1={ax-7} y1={ay-16} x2={ax-3} y2={ay-32}
                    stroke="#5577ee" strokeWidth="1.2" strokeLinecap="round" opacity={0.5}/>
                  {/* Link 3 - wrist */}
                  <line x1={ax-3} y1={ay-32} x2={ax+4} y2={ay-38}
                    stroke="#2244bb" strokeWidth="3" strokeLinecap="round"/>
                  {/* Joints */}
                  {[[ax,ay+2],[ax-7,ay-16],[ax-3,ay-32],[ax+4,ay-38]].map(([jx,jy],i) => (
                    <circle key={i} cx={jx} cy={jy} r={i===0?3.5:2.5}
                      fill="#1a2060" stroke="#4466ff" strokeWidth="1"/>
                  ))}
                  {/* Gripper */}
                  <rect x={ax+2} y={ay-42} width={8} height={4} rx="0.8"
                    fill="#ccaa00" stroke="#ffdd00" strokeWidth="0.6"/>
                  <line x1={ax+2} y1={ay-41} x2={ax+2} y2={ay-38} stroke="#ffdd00" strokeWidth="1.2"/>
                  <line x1={ax+10} y1={ay-41} x2={ax+10} y2={ay-38} stroke="#ffdd00" strokeWidth="1.2"/>
                  {/* Label */}
                  <text x={ax} y={ay+9} textAnchor="middle"
                    fill="#4466cc" fontSize="3.5" fontFamily="monospace" fontWeight="700">UR10</text>
                </g>
              );
            })()}
          </g>
        );
      })}

      {/* ── CONVEYOR BELT ── */}
      {(() => {
        const {sx,sy} = toSVG(10, 1.8);
        return (
          <g>
            {/* Body shadow */}
            <rect x={sx-78} y={sy-7} width={156} height={14} rx="3" fill="#000" opacity={0.4}/>
            {/* Main body */}
            <rect x={sx-76} y={sy-7} width={152} height={14} rx="3"
              fill="#141414" stroke="#444" strokeWidth="1"/>
            {/* Belt surface */}
            <rect x={sx-73} y={sy-4.5} width={146} height={9} rx="2" fill="#0d0d0d"/>
            {/* Stripes */}
            {Array.from({length:14},(_,i) => i*11-72).map((ox,i) => (
              <rect key={i} x={sx+ox} y={sy-4.5} width={3} height={9}
                fill="#e6b800" opacity={0.5}/>
            ))}
            {/* End rollers */}
            <circle cx={sx-76} cy={sy} r={7} fill="#252525" stroke="#555" strokeWidth="1"/>
            <circle cx={sx+76} cy={sy} r={7} fill="#252525" stroke="#555" strokeWidth="1"/>
            {/* Roller detail */}
            <circle cx={sx-76} cy={sy} r={3} fill="#333"/>
            <circle cx={sx+76} cy={sy} r={3} fill="#333"/>
            {/* Label */}
            <text x={sx} y={sy+1.5} textAnchor="middle"
              fill="#555" fontSize="5.5" fontFamily="monospace" fontWeight="800" letterSpacing="1">
              CONVEYOR
            </text>
          </g>
        );
      })()}

      {/* ── STAGING AREA ── */}
      {(() => {
        const {sx,sy} = toSVG(2.5, 4.5);
        return (
          <g>
            {/* Pad */}
            <rect x={sx-25} y={sy-14} width={50} height={28} rx="2"
              fill="#07112a" stroke="#e6b800" strokeWidth="1.2"
              strokeDasharray="6,4" opacity={0.9}/>
            {/* Inner glow */}
            <rect x={sx-23} y={sy-12} width={46} height={24} rx="1"
              fill="none" stroke="#e6b800" strokeWidth="0.3" opacity={0.2}/>
            {/* Charging station */}
            <rect x={sx-24} y={sy-13} width={8} height={26} rx="1.5"
              fill="#090f2a" stroke="#0055ee" strokeWidth="1"/>
            <rect x={sx-23} y={sy-12} width={6} height={8} rx="1"
              fill="#0a1840" stroke="#0066ff" strokeWidth="0.5"/>
            <circle cx={sx-20} cy={sy} r={3.5} fill="#00ee66" opacity={0.9}
              filter="url(#softglow)"/>
            <text x={sx-20} y={sy+7} textAnchor="middle"
              fill="#0066ff" fontSize="3" fontFamily="monospace" fontWeight="700">CHG</text>
            {/* Staging label */}
            <text x={sx+5} y={sy-8} textAnchor="middle" fill="#e6b800"
              fontSize="5" fontFamily="monospace" fontWeight="800" opacity={0.85}>
              STAGING
            </text>
          </g>
        );
      })()}

      {/* ── DROP-OFF ZONE ── */}
      {(() => {
        const {sx,sy} = toSVG(10, 3.5);
        return (
          <g>
            <rect x={sx-22} y={sy-5} width={44} height={10} rx="2"
              fill="#001a0a" stroke="#00ff9d" strokeWidth="1.2"
              strokeDasharray="5,3" opacity={0.6}/>
            <text x={sx} y={sy+1} textAnchor="middle"
              fill="#00ff9d" fontSize="3" fontFamily="monospace" opacity={0.5}>DROP-OFF</text>
          </g>
        );
      })()}

      {/* ── SELECTED ROBOT PATH ── */}
      {sel?.zone && ZONE_PATHS[sel.zone] && (
        <g>
          {ZONE_PATHS[sel.zone].map((p,i,arr) => {
            if (i === arr.length-1) return null;
            const {sx:x1,sy:y1} = toSVG(p.x,p.y);
            const {sx:x2,sy:y2} = toSVG(arr[i+1].x,arr[i+1].y);
            return (
              <g key={i}>
                <line x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="#00c8ff" strokeWidth="2.5" strokeDasharray="6,3" opacity={0.25}/>
                <line x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="#00c8ff" strokeWidth="1.2" strokeDasharray="6,3" opacity={0.8}/>
              </g>
            );
          })}
          {ZONE_PATHS[sel.zone].map((p,i) => {
            const {sx,sy} = toSVG(p.x,p.y);
            return <circle key={i} cx={sx} cy={sy} r={3} fill="#00c8ff" opacity={0.7}/>;
          })}
        </g>
      )}

      {/* ── ROBOTS ── */}
      {rl.map(r => {
        const rx = r.x ?? 2.5, ry = r.y ?? 4.5;
        const {sx,sy} = toSVG(rx, ry);
        const isSel = r.id === selectedId;
        const color = statusColor(r.status);
        const num   = r.id.replace("agv_0","");

        return (
          <g key={r.id}
            onClick={() => onSelect(r.id === selectedId ? null : r.id)}
            style={{ cursor:"pointer" }}
            filter={isSel ? "url(#glow)" : "url(#softglow)"}>

            {/* Outer pulse ring when selected */}
            {isSel && (
              <circle cx={sx} cy={sy} r={16} fill="none"
                stroke={color} strokeWidth="1" opacity={0.3}/>
            )}
            {/* Selection ring */}
            {isSel && (
              <circle cx={sx} cy={sy} r={13} fill="none"
                stroke={color} strokeWidth="1.5" opacity={0.5}/>
            )}

            {/* AGV shadow */}
            <rect x={sx-10} y={sy-5} width={20} height={11} rx="2.5"
              fill="#000" opacity={0.5}/>
            {/* AGV chassis */}
            <rect x={sx-9} y={sy-6} width={18} height={11} rx="2.5"
              fill={statusBg(r.status)} stroke={color} strokeWidth={isSel?1.8:1.2}
              opacity={0.95}/>
            {/* Top deck plate */}
            <rect x={sx-7} y={sy-4.5} width={14} height={8} rx="1.5"
              fill={color} opacity={0.18}/>
            {/* Center panel */}
            <rect x={sx-4} y={sy-3} width={8} height={5} rx="1"
              fill={color} opacity={0.35}/>
            {/* Orange stripe */}
            <rect x={sx-9} y={sy-0.5} width={18} height={2} rx="0"
              fill="#ff5500" opacity={0.3}/>
            {/* Direction arrow */}
            <polygon
              points={`${sx+9},${sy+0.5} ${sx+6},${sy-2} ${sx+6},${sy+3}`}
              fill={color} opacity={0.8}/>
            {/* Wheels */}
            {[[-6,-6],[6,-6],[-6,5],[6,5]].map(([wx,wy],i) => (
              <circle key={i} cx={sx+wx} cy={sy+wy} r={1.8}
                fill="#111" stroke={color} strokeWidth="0.6" opacity={0.7}/>
            ))}
            {/* Box on AGV when carrying */}
            {r.carrying && (
              <g>
                <rect x={sx-5} y={sy-8} width={10} height={7} rx="1"
                  fill="#ff9922" stroke="#ffcc44" strokeWidth="0.8" opacity={0.9}/>
                <rect x={sx-4} y={sy-7.5} width={8} height={2} rx="0.5"
                  fill="#fff" opacity={0.15}/>
                <text x={sx} y={sy-3.5} textAnchor="middle"
                  fill="#ffcc44" fontSize="3.5" fontFamily="monospace" fontWeight="800">📦</text>
              </g>
            )}
            {/* Fault indicator */}
            {r.status === "fault" && (
              <text x={sx+10} y={sy-6} fill="#ff3d5a" fontSize="9"
                filter="url(#softglow)">⚠</text>
            )}
            {/* Robot number badge */}
            <circle cx={sx} cy={sy+0.5} r={4.5}
              fill={color} opacity={0.15}/>
            <text x={sx} y={sy+2.5} textAnchor="middle"
              fill={color} fontSize="5.5" fontFamily="monospace" fontWeight="900">
              {num}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Mission Modal ─────────────────────────────────────────────────────────
function MissionModal({ onClose, onDispatch, connected }) {
  const [form, setForm] = useState({
    hourly_target:"", material_type:"", weight_kg:"", source:"Zone A", dock:"Dock 1"
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const robots = Math.max(1, Math.min(4, Math.ceil((parseInt(form.hourly_target)||30)/15)));

  useEffect(() => {
    const m = form.material_type.toLowerCase();
    if (m.includes("auto")||m.includes("parts"))        setForm(f=>({...f,source:"Zone A"}));
    else if (m.includes("elec"))                         setForm(f=>({...f,source:"Zone B"}));
    else if (m.includes("raw")||m.includes("material")) setForm(f=>({...f,source:"Zone C"}));
  }, [form.material_type]);

  const dispatch = async () => {
    setBusy(true);
    const mission = {
      hourly_target: parseInt(form.hourly_target)||30,
      material_type: form.material_type||"General",
      weight_kg: parseFloat(form.weight_kg)||25,
      source: form.source, dock: form.dock, robots,
    };
    try {
      const res  = await fetch(`${API_BASE_URL}/dispatch-mission`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify(mission),
      });
      const data = await res.json();
      setDone({ ok:true, robots:data.robots, zone:data.zone, eta:data.eta_minutes });
    } catch {
      const ok = onDispatch("/aria/mission", mission);
      setDone({ ok, robots: Array.from({length:robots},(_,i)=>`AGV-0${i+1}`) });
    }
    setBusy(false);
  };

  const zc = { "Zone A":"#ff4444", "Zone B":"#22dd66", "Zone C":"#ff9922" };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:200,
      backdropFilter:"blur(4px)" }}>
      <div style={{ background:"#0a1020", border:"1px solid #00c8ff",
        borderRadius:16, padding:28, width:460,
        boxShadow:"0 0 80px #00c8ff1a, 0 0 120px #00c8ff0a" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ fontSize:16, fontWeight:900, color:"#00c8ff", fontFamily:"monospace", letterSpacing:"0.1em" }}>
            ⚡ DISPATCH MISSION
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"#3a4a6a", fontSize:24, cursor:"pointer" }}>×</button>
        </div>

        {done ? (
          <div style={{ textAlign:"center", padding:"16px 0" }}>
            {done.ok ? (
              <>
                <div style={{ fontSize:52, marginBottom:12 }}>🚀</div>
                <div style={{ color:"#00ff9d", fontSize:18, fontWeight:900, marginBottom:8, fontFamily:"monospace" }}>
                  MISSION DISPATCHED
                </div>
                <div style={{ color:zc[done.zone]||"#00c8ff", fontSize:15, marginBottom:8, fontWeight:700 }}>{done.zone}</div>
                <div style={{ color:"#3a4a6a", fontSize:13, marginBottom:4 }}>
                  Activated: {done.robots?.join(", ")}
                </div>
                {done.eta && <div style={{ color:"#3a4a6a", fontSize:12 }}>~{done.eta} min/cycle</div>}
              </>
            ) : (
              <>
                <div style={{ fontSize:44 }}>⚠️</div>
                <div style={{ color:"#ff3d5a", fontSize:14, marginTop:8 }}>Check rosbridge connection</div>
              </>
            )}
            <button onClick={onClose} style={{ marginTop:20, background:"#1a2640",
              border:"none", borderRadius:8, padding:"10px 28px",
              color:"#dde6f8", fontSize:13, cursor:"pointer", fontFamily:"monospace" }}>
              CLOSE
            </button>
          </div>
        ) : (
          <>
            <div style={{ display:"flex", gap:10, marginBottom:18 }}>
              <div style={{ flex:1, background:"#060c18", border:"1px solid #1a2640",
                borderRadius:8, padding:"10px 14px" }}>
                <div style={{ fontSize:9, color:"#3a4a6a", marginBottom:4, fontFamily:"monospace", letterSpacing:"0.12em" }}>
                  AUTO-DETECTED ZONE
                </div>
                <div style={{ fontSize:15, fontWeight:900, color:zc[form.source]||"#00c8ff", fontFamily:"monospace" }}>
                  {form.source}
                </div>
              </div>
              <div style={{ flex:1, background:"#060c18", border:"1px solid #1a2640",
                borderRadius:8, padding:"10px 14px", textAlign:"right" }}>
                <div style={{ fontSize:9, color:"#3a4a6a", marginBottom:4, fontFamily:"monospace", letterSpacing:"0.12em" }}>
                  AGVs TO DISPATCH
                </div>
                <div style={{ fontSize:26, fontWeight:900, color:"#00ff9d", fontFamily:"monospace" }}>{robots}</div>
              </div>
            </div>

            {[
              ["hourly_target","HOURLY TARGET (units/hr)","e.g. 30","number"],
              ["material_type","MATERIAL TYPE","auto parts / electronics / raw material","text"],
              ["weight_kg","WEIGHT PER UNIT (kg)","e.g. 25","number"],
            ].map(([f,l,p,t]) => (
              <div key={f} style={{ marginBottom:12 }}>
                <div style={{ fontSize:9, color:"#3a4a6a", marginBottom:5,
                  fontFamily:"monospace", letterSpacing:"0.12em" }}>{l}</div>
                <input type={t} placeholder={p} value={form[f]}
                  onChange={e => setForm(x=>({...x,[f]:e.target.value}))}
                  style={{ width:"100%", background:"#060c18", border:"1px solid #1a2640",
                    borderRadius:8, padding:"10px 14px", color:"#dde6f8",
                    fontSize:13, outline:"none", fontFamily:"monospace", boxSizing:"border-box" }}/>
              </div>
            ))}

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:18 }}>
              {[
                ["source","SOURCE ZONE",["Zone A","Zone B","Zone C"]],
                ["dock","DESTINATION DOCK",["Dock 1","Dock 2","Dock 3","Dock 4"]],
              ].map(([f,l,opts]) => (
                <div key={f}>
                  <div style={{ fontSize:9, color:"#3a4a6a", marginBottom:5,
                    fontFamily:"monospace", letterSpacing:"0.12em" }}>{l}</div>
                  <select value={form[f]} onChange={e => setForm(x=>({...x,[f]:e.target.value}))}
                    style={{ width:"100%", background:"#060c18", border:"1px solid #1a2640",
                      borderRadius:8, padding:"10px 12px", color:"#dde6f8",
                      fontSize:13, outline:"none", cursor:"pointer", fontFamily:"monospace" }}>
                    {opts.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <button onClick={dispatch} disabled={busy} style={{
              width:"100%",
              background: busy ? "#1a2640" : "linear-gradient(135deg, #00ff9d 0%, #00c8ff 100%)",
              border:"none", borderRadius:10, padding:14,
              color:"#000", fontSize:14, fontWeight:900,
              cursor: busy ? "not-allowed" : "pointer",
              fontFamily:"monospace", letterSpacing:"0.08em",
              boxShadow: busy ? "none" : "0 0 20px #00ff9d33" }}>
              {busy ? "DISPATCHING..." : `🚀 DISPATCH ${robots} AGVs → ${form.source}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── AI Chat ───────────────────────────────────────────────────────────────
function AIChat({ robots, faults }) {
  const [msgs, setMsgs]   = useState([{ role:"aria", text:"ARIA online. Ask me about faults, routing, or maintenance.\n\nSuggestions:\n• Explain current fault codes\n• How many AGVs for 60 units/hr?\n• Maintenance checklist for AGV-03" }]);
  const [input, setInput] = useState("");
  const [busy, setBusy]   = useState(false);
  const endRef = useRef(null);
  useEffect(() => endRef.current?.scrollIntoView({behavior:"smooth"}), [msgs]);

  const send = async () => {
    if (!input.trim()||busy) return;
    const q = input.trim(); setInput(""); setBusy(true);
    setMsgs(m=>[...m,{role:"user",text:q}]);
    try {
      const res  = await fetch(`${API_BASE_URL}/ask-aria`,{
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({question:q, context:{robots,faults}}),
      });
      const data = await res.json();
      setMsgs(m=>[...m,{role:"aria",text:data.response}]);
    } catch {
      setMsgs(m=>[...m,{role:"aria",text:"⚠ Backend offline. Start uvicorn on port 8000."}]);
    }
    setBusy(false);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      <div style={{ flex:1, overflowY:"auto", padding:"10px 14px",
        display:"flex", flexDirection:"column", gap:10 }}>
        {msgs.map((m,i) => (
          <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
            <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0,
              background: m.role==="aria"
                ? "linear-gradient(135deg,#00c8ff,#a855f7)" : "#1a2640",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:10, fontWeight:900, color:"#fff", fontFamily:"monospace" }}>
              {m.role==="aria"?"AI":"U"}
            </div>
            <div style={{ background: m.role==="aria"?"#080f1e":"#0f1826",
              border:`1px solid ${m.role==="aria"?"#1a3050":"#1a2640"}`,
              borderRadius:10, padding:"10px 14px", flex:1,
              fontSize:12, lineHeight:1.8, color:"#ccd8ee",
              whiteSpace:"pre-wrap", fontFamily:"monospace" }}>
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div style={{ color:"#3a4a6a", fontSize:12, paddingLeft:36, fontFamily:"monospace" }}>
            analyzing...
          </div>
        )}
        <div ref={endRef}/>
      </div>
      <div style={{ padding:"10px 14px", borderTop:"1px solid #1a2640" }}>
        <div style={{ display:"flex", gap:8 }}>
          <input value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&send()}
            placeholder="Ask ARIA about faults, routing, optimization..."
            style={{ flex:1, background:"#060c18", border:"1px solid #1a2640",
              borderRadius:8, padding:"10px 14px", color:"#dde6f8",
              fontSize:12, outline:"none", fontFamily:"monospace" }}/>
          <button onClick={send} disabled={busy} style={{
            background: busy ? "#1a2640" : "linear-gradient(135deg,#00c8ff,#a855f7)",
            border:"none", borderRadius:8, padding:"10px 18px",
            color:"#fff", fontSize:12, fontWeight:700,
            cursor:"pointer", fontFamily:"monospace" }}>ASK</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────
export default function ARIA() {
  const { robots, connected, publish } = useRosBridge(ROS_WS_URL);
  const [selId, setSelId]   = useState(null);
  const [tab, setTab]       = useState("map");
  const [modal, setModal]   = useState(false);
  const [faults, setFaults] = useState([]);
  const [time, setTime]     = useState(new Date());

  useEffect(() => {
    const t = setInterval(()=>setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-detect faults from live data
  useEffect(() => {
    const live = Object.entries(robots)
      .filter(([,r]) => r.status==="fault" && r.fault)
      .map(([id,r]) => ({
        id, robot: id.replace("agv_0","AGV-"),
        time: new Date().toLocaleTimeString(),
        code: r.fault, msg: `${id.toUpperCase()}: ${r.fault}`
      }));
    if (live.length) {
      setFaults(prev => {
        const ex = new Set(prev.map(f=>f.id));
        return [...prev, ...live.filter(f=>!ex.has(f.id))];
      });
    }
  }, [robots]);

  const rl         = Object.entries(robots).map(([id,r])=>({id,...r}));
  const active     = rl.filter(r=>r.status==="active").length;
  const faultCount = rl.filter(r=>r.status==="fault").length;
  const idle       = rl.filter(r=>r.status==="idle").length;
  const avgBatt    = rl.length
    ? Math.round(rl.reduce((s,r)=>s+(r.battery||100),0)/rl.length) : 100;
  const sel        = rl.find(r=>r.id===selId);

  const tabs = [
    { id:"map",    label:"FLEET MAP" },
    { id:"robots", label:"ROBOTS" },
    { id:"alerts", label:`ALERTS${faultCount>0?` (${faultCount})`:""}`, alert:faultCount>0 },
    { id:"aria",   label:"ARIA AI" },
    { id:"zones",  label:"ZONES" },
  ];

  return (
    <div style={{ background:"#05090f", minHeight:"100vh", color:"#ccd8ee",
      fontFamily:"monospace", display:"flex", flexDirection:"column",
      overflow:"hidden", height:"100vh" }}>
      <style>{`
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:3px; }
        ::-webkit-scrollbar-thumb { background:#1a2640; border-radius:2px; }
        select option { background:#0a1020; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.25} }
        @keyframes pulsering { 0%{transform:scale(1);opacity:0.5} 100%{transform:scale(1.4);opacity:0} }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"8px 20px", borderBottom:"1px solid #0d1a2e",
        background:"linear-gradient(90deg, #05090f 0%, #080f1e 100%)",
        flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ width:40, height:40, borderRadius:10,
            background:"linear-gradient(135deg,#00c8ff,#a855f7)",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:20, flexShrink:0 }}>🤖</div>
          <div>
            <div style={{ fontSize:"clamp(13px,1.6vw,20px)", fontWeight:900, letterSpacing:"0.06em",
              background:"linear-gradient(90deg,#fff,#00c8ff)", WebkitBackgroundClip:"text",
              WebkitTextFillColor:"transparent" }}>
              ARIA FLEET COMMANDER
              <span style={{ fontSize:"0.5em", WebkitTextFillColor:"#3a4a6a",
                marginLeft:10, letterSpacing:"0.02em" }}>v2.0</span>
            </div>
            <div style={{ fontSize:"clamp(8px,0.7vw,10px)", color:"#3a4a6a", letterSpacing:"0.18em" }}>
              AUTONOMOUS ROBOTICS INTELLIGENCE & ADMINISTRATION
            </div>
          </div>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {/* ROS status */}
          <div style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 12px",
            borderRadius:6,
            background: connected ? "#001f14" : "#150008",
            border:`1px solid ${connected?"#00ff9d":"#ff3d5a"}`,
            fontSize:"clamp(9px,0.8vw,12px)", fontWeight:700,
            color: connected ? "#00ff9d" : "#ff3d5a" }}>
            <div style={{ width:6, height:6, borderRadius:"50%",
              background: connected ? "#00ff9d" : "#ff3d5a",
              animation: connected ? "none" : "blink 1s infinite",
              boxShadow: connected ? "0 0 6px #00ff9d" : "none" }}/>
            {connected ? "ROS LIVE" : "ROS OFFLINE"}
          </div>

          {faultCount > 0 && (
            <div style={{ padding:"5px 12px", borderRadius:6,
              background:"#150008", border:"1px solid #ff3d5a",
              fontSize:"clamp(9px,0.8vw,12px)", fontWeight:700, color:"#ff3d5a",
              animation:"blink 1.5s infinite" }}>
              ⚠ {faultCount} FAULT{faultCount>1?"S":""}
            </div>
          )}

          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:"clamp(13px,1.2vw,16px)", fontWeight:700,
              color:"#00c8ff", letterSpacing:"0.05em" }}>
              {time.toLocaleTimeString()}
            </div>
            <div style={{ fontSize:"clamp(8px,0.65vw,10px)", color:"#3a4a6a" }}>
              {time.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}
            </div>
          </div>

          <button onClick={()=>setModal(true)} style={{
            background:"linear-gradient(135deg,#00ff9d,#00c8ff)",
            border:"none", borderRadius:8, padding:"8px 18px",
            color:"#000", fontSize:"clamp(10px,0.9vw,13px)", fontWeight:900,
            cursor:"pointer", letterSpacing:"0.06em",
            boxShadow:"0 0 16px #00ff9d33" }}>
            + MISSION
          </button>
        </div>
      </div>

      {/* ── KPI BAR ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)",
        gap:"1px", background:"#0d1a2e", flexShrink:0,
        borderBottom:"1px solid #0d1a2e" }}>
        {[
          { label:"ACTIVE AGVs", value:active, unit:`/${rl.length||6}`, color:"#00ff9d",
            sub: active>0 ? `${rl.filter(r=>r.state==="picking").length} picking · ${rl.filter(r=>r.state==="delivering").length} delivering` : "dispatch a mission" },
          { label:"FAULTS", value:faultCount, color: faultCount>0?"#ff3d5a":"#00ff9d",
            sub: faultCount>0 ? "needs attention" : "all clear" },
          { label:"IDLE / STAGING", value:idle, color:"#3a4a6a", sub:"ready to dispatch" },
          { label:"AVG BATTERY", value:avgBatt, unit:"%",
            color: avgBatt>50?"#00ff9d":avgBatt>20?"#ffb800":"#ff3d5a",
            sub:"fleet average" },
          { label:"THROUGHPUT", value:73, unit:"u/hr", color:"#00c8ff", sub:"target: 65 u/hr" },
          { label:"ROSBRIDGE", value:connected?"LIVE":"OFF",
            color:connected?"#00ff9d":"#ff3d5a",
            sub:connected?"telemetry streaming":"reconnecting..." },
        ].map(k => (
          <div key={k.label} style={{ background:"#05090f", padding:"8px 14px" }}>
            <div style={{ fontSize:"clamp(7px,0.6vw,9px)", color:"#3a4a6a",
              letterSpacing:"0.14em", marginBottom:3 }}>{k.label}</div>
            <div style={{ fontSize:"clamp(16px,2vw,26px)", fontWeight:900,
              color:k.color, letterSpacing:"-0.02em", lineHeight:1 }}>
              {k.value}
              <span style={{ fontSize:"0.45em", color:"#3a4a6a", marginLeft:3 }}>{k.unit}</span>
            </div>
            <div style={{ fontSize:"clamp(7px,0.55vw,9px)", color:"#3a4a6a", marginTop:3 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── TABS ── */}
      <div style={{ display:"flex", borderBottom:"1px solid #0d1a2e",
        background:"#070d18", flexShrink:0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            background:"transparent", border:"none",
            borderBottom: tab===t.id ? `2px solid ${t.alert?"#ff3d5a":"#00c8ff"}` : "2px solid transparent",
            padding:"9px 20px", marginBottom:-1,
            color: tab===t.id ? (t.alert?"#ff3d5a":"#00c8ff") : "#3a4a6a",
            fontSize:"clamp(9px,0.75vw,11px)", fontWeight: tab===t.id?700:400,
            cursor:"pointer", letterSpacing:"0.12em",
            animation: t.alert?"blink 1.5s infinite":"none" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── CONTENT ── */}
      <div style={{ flex:1, overflow:"hidden", display:"flex", minHeight:0 }}>

        {/* ══ FLEET MAP ══ */}
        {tab === "map" && (
          <div style={{ flex:1, display:"grid",
            gridTemplateColumns:"1fr 200px",
            overflow:"hidden", minHeight:0 }}>

            {/* Map panel */}
            <div style={{ background:"#05090f", padding:"10px 14px",
              overflow:"hidden", display:"flex", flexDirection:"column", minHeight:0 }}>
              <div style={{ fontSize:"clamp(8px,0.65vw,10px)", color:"#3a4a6a",
                marginBottom:6, letterSpacing:"0.12em" }}>
                LIVE WAREHOUSE FLOOR · {rl.length||6} ROBOTS ONLINE · CLICK ROBOT TO INSPECT & SHOW PATH
              </div>
              <div style={{ flex:1, minHeight:0 }}>
                <WarehouseMap robots={robots} selectedId={selId} onSelect={setSelId}/>
              </div>
              {/* Legend */}
              <div style={{ display:"flex", gap:14, marginTop:6, flexWrap:"wrap" }}>
                {[["#00ff9d","Active"],["#ff3d5a","Fault"],["#3a4a6a","Idle"],
                  ["#ffb800","Charging"],["#ff9922","Carrying Box"]].map(([c,l]) => (
                  <div key={l} style={{ display:"flex", alignItems:"center", gap:4,
                    fontSize:"clamp(8px,0.6vw,10px)", color:"#3a4a6a" }}>
                    <span style={{ width:8, height:8, borderRadius:"50%",
                      background:c, display:"inline-block" }}/>{l}
                  </div>
                ))}
              </div>
            </div>

            {/* Inspector */}
            <div style={{ background:"#070d18", borderLeft:"1px solid #0d1a2e",
              padding:14, overflowY:"auto", display:"flex",
              flexDirection:"column", gap:10 }}>
              <div style={{ fontSize:"clamp(8px,0.65vw,10px)", color:"#3a4a6a",
                letterSpacing:"0.12em" }}>
                {sel ? `INSPECTING ${sel.id.toUpperCase()}` : "SELECT A ROBOT"}
              </div>

              {sel ? (
                <>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:"clamp(14px,1.3vw,18px)", fontWeight:900, color:"#fff" }}>
                      {sel.id.replace("agv_0","AGV-")}
                    </span>
                    <span style={{ padding:"2px 8px", borderRadius:20,
                      fontSize:"clamp(8px,0.6vw,10px)", fontWeight:800,
                      background:statusBg(sel.status), color:statusColor(sel.status),
                      border:`1px solid ${statusColor(sel.status)}44` }}>
                      {sel.status?.toUpperCase()}
                    </span>
                  </div>

                  {[
                    ["STATE",    sel.state||"staging"],
                    ["ZONE",     sel.zone||"—"],
                    ["TASK",     sel.task||"Standby"],
                    ["POS",      `X:${(sel.x||0).toFixed(1)} Y:${(sel.y||0).toFixed(1)}`],
                    ["CARRYING", sel.carrying ? "📦 YES" : "NO"],
                    ["FAULT",    sel.fault||"None"],
                  ].map(([k,v]) => (
                    <div key={k} style={{ borderBottom:"1px solid #0d1a2e", paddingBottom:8 }}>
                      <div style={{ fontSize:"clamp(7px,0.6vw,9px)", color:"#3a4a6a", marginBottom:2 }}>{k}</div>
                      <div style={{ fontSize:"clamp(10px,0.85vw,13px)",
                        color: k==="FAULT"&&sel.fault?"#ff3d5a":"#ccd8ee" }}>{v}</div>
                    </div>
                  ))}

                  <div>
                    <div style={{ fontSize:"clamp(7px,0.6vw,9px)", color:"#3a4a6a", marginBottom:5 }}>BATTERY</div>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ flex:1, height:5, background:"#1a2640", borderRadius:3 }}>
                        <div style={{
                          width:`${sel.battery??100}%`, height:"100%", borderRadius:3,
                          background: (sel.battery??100)>50?"#00ff9d":(sel.battery??100)>20?"#ffb800":"#ff3d5a",
                          transition:"width 1s",
                          boxShadow:(sel.battery??100)>50?"0 0 6px #00ff9d66":"none"
                        }}/>
                      </div>
                      <span style={{ fontSize:"clamp(9px,0.75vw,11px)", color:"#ccd8ee", minWidth:30 }}>
                        {Math.round(sel.battery??100)}%
                      </span>
                    </div>
                  </div>

                  {sel.zone && (
                    <div style={{ fontSize:"clamp(8px,0.65vw,10px)", color:"#00c8ff",
                      textAlign:"center", padding:"6px 8px",
                      background:"#060f20", borderRadius:6,
                      border:"1px solid #00c8ff22" }}>
                      PATH VISIBLE ON MAP ↑
                    </div>
                  )}

                  {sel.status==="fault" && (
                    <button onClick={()=>setTab("aria")} style={{
                      background:"linear-gradient(135deg,#00c8ff,#a855f7)",
                      border:"none", borderRadius:8, padding:"8px 10px",
                      color:"#fff", fontSize:"clamp(9px,0.75vw,11px)",
                      fontWeight:700, cursor:"pointer", fontFamily:"monospace" }}>
                      🤖 ASK ARIA FOR FIX
                    </button>
                  )}
                </>
              ) : (
                <div style={{ color:"#3a4a6a", fontSize:"clamp(9px,0.75vw,11px)",
                  textAlign:"center", padding:"30px 8px", lineHeight:2 }}>
                  Click any robot<br/>on the map to<br/>inspect & see<br/>intended path
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ ROBOTS TABLE ══ */}
        {tab === "robots" && (
          <div style={{ flex:1, overflow:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse",
              fontSize:"clamp(10px,0.85vw,13px)" }}>
              <thead>
                <tr style={{ borderBottom:"1px solid #0d1a2e", background:"#070d18", position:"sticky", top:0 }}>
                  {["ROBOT","STATUS","STATE","ZONE","BATTERY","TASK","POSITION"].map(h => (
                    <th key={h} style={{ padding:"10px 16px", textAlign:"left",
                      color:"#3a4a6a", fontSize:"clamp(7px,0.6vw,9px)",
                      letterSpacing:"0.12em", fontWeight:600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(rl.length > 0 ? rl :
                  ["agv_01","agv_02","agv_03","agv_04","agv_05","agv_06"]
                    .map(id=>({id,status:"idle",state:"staging",battery:100,task:"Waiting for ROS...",x:0,y:0,fault:null,zone:null}))
                ).map((r,i) => {
                  const c = statusColor(r.status);
                  return (
                    <tr key={r.id}
                      onClick={() => { setSelId(r.id); setTab("map"); }}
                      style={{ borderBottom:"1px solid #0d1a2e", cursor:"pointer",
                        background: i%2===0?"#05090f":"#070d18",
                        transition:"background 0.15s" }}>
                      <td style={{ padding:"12px 16px", fontWeight:700, color:"#fff" }}>
                        {r.id?.replace("agv_0","AGV-")}
                      </td>
                      <td style={{ padding:"12px 16px" }}>
                        <span style={{ padding:"3px 10px", borderRadius:20,
                          fontSize:"clamp(8px,0.65vw,10px)", fontWeight:800,
                          background:statusBg(r.status), color:c,
                          border:`1px solid ${c}33` }}>
                          {r.status?.toUpperCase()||"IDLE"}
                        </span>
                      </td>
                      <td style={{ padding:"12px 16px", color:"#3a4a6a", fontSize:"0.9em" }}>{r.state||"staging"}</td>
                      <td style={{ padding:"12px 16px", fontSize:"0.9em",
                        color:r.zone==="Zone A"?"#ff4444":r.zone==="Zone B"?"#22dd66":r.zone==="Zone C"?"#ff9922":"#3a4a6a" }}>
                        {r.zone||"—"}
                      </td>
                      <td style={{ padding:"12px 16px", minWidth:120 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <div style={{ flex:1, height:4, background:"#1a2640", borderRadius:2 }}>
                            <div style={{ width:`${r.battery??100}%`, height:"100%", borderRadius:2,
                              background:(r.battery??100)>50?"#00ff9d":(r.battery??100)>20?"#ffb800":"#ff3d5a",
                              transition:"width 1s" }}/>
                          </div>
                          <span style={{ fontSize:"0.85em", color:"#ccd8ee", minWidth:32 }}>
                            {Math.round(r.battery??100)}%
                          </span>
                        </div>
                      </td>
                      <td style={{ padding:"12px 16px", color:r.status==="fault"?"#ff3d5a":"#ccd8ee",
                        fontSize:"0.9em", maxWidth:200, overflow:"hidden",
                        textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {r.task||"Standby"}
                      </td>
                      <td style={{ padding:"12px 16px", color:"#3a4a6a", fontSize:"0.85em" }}>
                        X:{(r.x||0).toFixed(1)} Y:{(r.y||0).toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ══ ALERTS ══ */}
        {tab === "alerts" && (
          <div style={{ flex:1, overflow:"auto", padding:16,
            display:"flex", flexDirection:"column", gap:10 }}>
            {faults.length === 0 ? (
              <div style={{ background:"#070d18", border:"1px solid #0d1a2e",
                borderRadius:12, padding:48, textAlign:"center" }}>
                <div style={{ fontSize:32, marginBottom:10 }}>✅</div>
                <div style={{ color:"#00ff9d", fontSize:"clamp(12px,1vw,16px)", fontWeight:700 }}>
                  ALL SYSTEMS NOMINAL
                </div>
                <div style={{ color:"#3a4a6a", fontSize:"0.8em", marginTop:6 }}>
                  No active faults detected
                </div>
              </div>
            ) : faults.map(f => (
              <div key={f.id} style={{ background:"#070d18",
                border:"1px solid #ff3d5a33", borderLeft:"3px solid #ff3d5a",
                borderRadius:12, padding:18,
                boxShadow:"0 0 24px #ff3d5a0a" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
                    <span style={{ fontSize:26 }}>🚨</span>
                    <div>
                      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:5 }}>
                        <span style={{ fontSize:"clamp(12px,1vw,16px)", fontWeight:900, color:"#ff3d5a" }}>{f.robot}</span>
                        <span style={{ padding:"2px 8px", borderRadius:20,
                          fontSize:"0.7em", fontWeight:800,
                          background:"#2a0010", color:"#ff3d5a",
                          border:"1px solid #ff3d5a33" }}>FAULT</span>
                        <span style={{ fontSize:"0.75em", color:"#3a4a6a",
                          fontFamily:"monospace" }}>CODE: {f.code}</span>
                      </div>
                      <div style={{ color:"#ccd8ee", fontSize:"clamp(11px,0.9vw,14px)", marginBottom:4 }}>{f.msg}</div>
                      <div style={{ color:"#3a4a6a", fontSize:"0.75em" }}>Detected at {f.time}</div>
                    </div>
                  </div>
                  <button onClick={()=>setTab("aria")} style={{
                    background:"linear-gradient(135deg,#00c8ff,#a855f7)",
                    border:"none", borderRadius:8, padding:"7px 14px",
                    color:"#fff", fontSize:"clamp(9px,0.75vw,11px)",
                    fontWeight:700, cursor:"pointer", whiteSpace:"nowrap",
                    fontFamily:"monospace" }}>
                    🤖 ASK ARIA
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══ ARIA AI ══ */}
        {tab === "aria" && (
          <div style={{ flex:1, display:"flex", flexDirection:"column",
            overflow:"hidden", background:"#070d18" }}>
            <div style={{ padding:"12px 16px", borderBottom:"1px solid #0d1a2e",
              display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ width:36, height:36, borderRadius:"50%",
                background:"linear-gradient(135deg,#00c8ff,#a855f7)",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:16, flexShrink:0 }}>🤖</div>
              <div>
                <div style={{ fontWeight:900, fontSize:"clamp(11px,0.9vw,14px)",
                  color:"#00c8ff", letterSpacing:"0.06em" }}>
                  ARIA — FLEET INTELLIGENCE AGENT
                </div>
                <div style={{ fontSize:"clamp(8px,0.65vw,10px)", color:"#00ff9d" }}>
                  ● ONLINE · Powered by Groq / Claude
                </div>
              </div>
            </div>
            <div style={{ flex:1, overflow:"hidden" }}>
              <AIChat robots={robots} faults={faults}/>
            </div>
          </div>
        )}

        {/* ══ ZONES ══ */}
        {tab === "zones" && (
          <div style={{ flex:1, overflow:"auto", padding:14,
            display:"grid", gridTemplateColumns:"repeat(3,1fr)",
            gap:14, alignContent:"start" }}>
            {[
              { name:"Zone A", label:"Auto Parts",   color:"#ff4444", manip:"UR10-A", pos:"x:2, y:17.5" },
              { name:"Zone B", label:"Electronics",  color:"#22dd66", manip:"UR10-B", pos:"x:10, y:17.5" },
              { name:"Zone C", label:"Raw Material", color:"#ff9922", manip:"UR10-C", pos:"x:18, y:17.5" },
            ].map(z => {
              const zr      = rl.filter(r=>r.zone===z.name);
              const picking = zr.filter(r=>r.state==="picking").length;
              const loading = zr.filter(r=>r.carrying).length;
              return (
                <div key={z.name} style={{ background:"#070d18",
                  border:`1px solid ${z.color}33`, borderTop:`3px solid ${z.color}`,
                  borderRadius:12, padding:18,
                  boxShadow:`0 0 30px ${z.color}08` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
                    <div>
                      <div style={{ fontSize:"clamp(14px,1.2vw,18px)", fontWeight:900, color:z.color }}>{z.name}</div>
                      <div style={{ fontSize:"clamp(9px,0.75vw,11px)", color:"#3a4a6a", marginTop:2 }}>{z.label}</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:"clamp(22px,2.2vw,32px)", fontWeight:900, color:z.color, lineHeight:1 }}>
                        {zr.length}
                      </div>
                      <div style={{ fontSize:"clamp(8px,0.65vw,10px)", color:"#3a4a6a" }}>AGVs</div>
                    </div>
                  </div>

                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14 }}>
                    {[
                      ["MANIPULATOR", z.manip, z.color],
                      ["POSITION",   z.pos,    "#3a4a6a"],
                      ["PICKING NOW",`${picking} AGV${picking!==1?"s":""}`, picking>0?z.color:"#3a4a6a"],
                      ["LOADED",     `${loading} AGV${loading!==1?"s":""}`, loading>0?"#ff9922":"#3a4a6a"],
                    ].map(([k,v,c]) => (
                      <div key={k} style={{ background:"#05090f", borderRadius:6, padding:"8px 10px" }}>
                        <div style={{ fontSize:"clamp(7px,0.6vw,9px)", color:"#3a4a6a", marginBottom:3, letterSpacing:"0.1em" }}>{k}</div>
                        <div style={{ fontSize:"clamp(10px,0.85vw,12px)", fontWeight:700, color:c }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ height:4, background:"#1a2640", borderRadius:2, marginBottom:14 }}>
                    <div style={{ width:`${(zr.length/6)*100}%`, height:"100%",
                      background:z.color, borderRadius:2,
                      boxShadow:`0 0 6px ${z.color}66`, transition:"width 0.5s" }}/>
                  </div>

                  {zr.length === 0 ? (
                    <div style={{ color:"#3a4a6a", fontSize:"clamp(9px,0.75vw,11px)",
                      textAlign:"center", padding:"10px 0" }}>
                      No AGVs — dispatch a mission
                    </div>
                  ) : zr.map(r => (
                    <div key={r.id}
                      onClick={() => { setSelId(r.id); setTab("map"); }}
                      style={{ display:"flex", justifyContent:"space-between",
                        alignItems:"center", padding:"6px 8px",
                        borderBottom:"1px solid #0d1a2e", cursor:"pointer",
                        borderRadius:4 }}>
                      <span style={{ fontSize:"clamp(10px,0.85vw,13px)", color:"#fff", fontWeight:700 }}>
                        {r.id.replace("agv_0","AGV-")}
                      </span>
                      <span style={{ fontSize:"clamp(8px,0.65vw,10px)", color:"#3a4a6a" }}>{r.state}</span>
                      {r.carrying && <span>📦</span>}
                      <span style={{ padding:"1px 6px", borderRadius:20,
                        fontSize:"clamp(7px,0.6vw,9px)", fontWeight:700,
                        background:statusBg(r.status), color:statusColor(r.status) }}>
                        {r.status?.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modal && (
        <MissionModal
          onClose={()=>setModal(false)}
          onDispatch={publish}
          connected={connected}/>
      )}
    </div>
  );
}
