from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.agents.aria_agent import ARIAAgent
import json, asyncio

app = FastAPI(title="ARIA Fleet Commander API")
app.add_middleware(CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

agent = ARIAAgent()

# ── Ask ARIA ────────────────────────────────────────────────────────────────
@app.post("/ask-aria")
async def ask_aria(payload: dict):
    question = payload.get("question", "")
    context  = payload.get("context", {})
    response = await agent.answer(question, context)
    return {"response": response}

# ── Dispatch Mission ────────────────────────────────────────────────────────
@app.post("/dispatch-mission")
async def dispatch_mission(payload: dict):
    import websockets

    robots_needed = max(1, min(6, payload.get("robots", 2)))

    mission = {
        "source":   payload.get("source",        "Zone A"),
        "dock":     payload.get("dock",           "Dock 1"),
        "robots":   robots_needed,
        "material": payload.get("material_type",  "General"),
        "weight":   payload.get("weight_kg",      25),
    }

    # Publish to ROS2 via rosbridge WebSocket on GCP VM
    ros_published = False
    try:
        ros_ws_url = "ws://35.236.53.100:9090"
        async with websockets.connect(ros_ws_url, open_timeout=5) as ws:
            ros_msg = json.dumps({
                "op":    "publish",
                "topic": "/aria/mission",
                "msg":   {"data": json.dumps(mission)},
            })
            await ws.send(ros_msg)
            ros_published = True
    except Exception as e:
        print(f"[ARIA] rosbridge publish failed: {e}")

    robots = [f"AGV-{i+1:02d}" for i in range(robots_needed)]
    return {
        "status":       "dispatched",
        "robots":       robots,
        "mission":      mission,
        "ros_published": ros_published,
    }

# ── Health ──────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "online", "aria": "v1.0.0"}
