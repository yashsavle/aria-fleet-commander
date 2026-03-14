# 🤖 ARIA — Autonomous Robotics Intelligence & Administration

<div align="center">

![ARIA Banner](https://img.shields.io/badge/ARIA-Fleet%20Commander-00c8ff?style=for-the-badge&logo=ros&logoColor=white)
![ROS2](https://img.shields.io/badge/ROS2-Humble-22314E?style=for-the-badge&logo=ros&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10-3776AB?style=for-the-badge&logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Gazebo](https://img.shields.io/badge/Gazebo-Classic%2011-FF6600?style=for-the-badge)

**An AI-powered warehouse AGV fleet management system built with ROS2, Gazebo simulation, and a real-time React dashboard.**

[Features](#features) • [Architecture](#architecture) • [Setup](#setup) • [Usage](#usage) • [Demo](#demo)

</div>

---

## 📸 Demo

> 6 TurtleBot3 AGVs navigating a warehouse floor in Gazebo simulation, with real-time telemetry streamed to a live React dashboard via ROS2 WebSocket bridge.

| Gazebo Simulation | ARIA Dashboard |
|---|---|
| 6 AGVs navigating warehouse floor | Live fleet map with robot positions |
| Waypoint patrol routes | Real-time battery, status, fault alerts |
| Physics-based collision detection | AI-powered fault diagnosis chatbot |

---

## ✨ Features

### 🏭 Fleet Management
- **6 AGV robots** simulated in Gazebo Classic with real TurtleBot3 physics
- **Waypoint navigation** — each robot follows a unique patrol route around the warehouse
- **Real odometry** — dashboard positions match Gazebo exactly via `/agv_XX/odom` topics
- **Auto-activation** — 3 robots start patrolling on launch, 3 wait for mission dispatch
- **Battery simulation** — gradual drain, auto-return to charging station below 20%

### 🚨 Fault Simulation
- **Random fault injection** every 25 seconds for realistic demo scenarios
- **Fault codes:** `ENC_ERR_04`, `BATT_CELL_FAIL`, `LIDAR_TIMEOUT`, `ESTOP_TRIGGERED`, `NAV_STUCK`
- Faults appear live on dashboard with blinking alerts

### 📡 Real-Time Communication
- **ROS2 Humble** — full robot middleware stack
- **rosbridge WebSocket** — streams live telemetry to browser dashboard
- **FastAPI backend** — bridges dashboard mission dispatch to ROS2 topics
- **WebSocket reconnection** — dashboard auto-reconnects if connection drops

### 🎯 Mission Dispatch
- Fill in hourly target, material type, weight, source zone, destination dock
- Auto-calculates how many robots to dispatch based on throughput requirement
- Publishes to `/aria/mission` ROS2 topic via rosbridge
- Idle robots activate immediately and begin navigating in Gazebo

### 🤖 ARIA AI Assistant
- Powered by **Groq (free)** or **Anthropic Claude**
- Answers questions about fault codes, maintenance procedures, route optimization
- Context-aware — knows current fleet status and active faults
- Quick suggestion buttons for common queries

### 📊 Dashboard
- **Fleet Map** — live SVG warehouse map with robot positions, intended paths, zone labels, docks
- **Robots Tab** — sortable table with battery bars, status pills, position coordinates
- **Alerts Tab** — fault log with severity levels and one-click AI diagnosis
- **Docks Tab** — throughput gauges for each loading dock
- **KPI Cards** — active count, fault count, average battery, throughput

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Mac (Local)                          │
│                                                             │
│  ┌─────────────────┐      ┌──────────────────────────────┐ │
│  │  React Dashboard │      │     FastAPI Backend          │ │
│  │  (Vite + React)  │◄────►│  /ask-aria  /dispatch-mission│ │
│  │  localhost:5173  │      │  localhost:8000              │ │
│  └────────┬─────────┘      └──────────────┬───────────────┘ │
│           │ WebSocket                      │ WebSocket       │
└───────────┼────────────────────────────────┼─────────────────┘
            │                                │
            ▼                                ▼
┌─────────────────────────────────────────────────────────────┐
│                    GCP VM (Ubuntu 22.04)                     │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              rosbridge WebSocket :9090                │  │
│  └──────────────────────┬───────────────────────────────┘  │
│                         │ ROS2 Topics                        │
│  ┌──────────────────────▼───────────────────────────────┐  │
│  │              ARIA Fleet Manager Node                  │  │
│  │  /aria/telemetry  /aria/mission  /agv_XX/cmd_vel     │  │
│  │  /agv_XX/odom (real positions from Gazebo)           │  │
│  └──────────────────────┬───────────────────────────────┘  │
│                         │                                    │
│  ┌──────────────────────▼───────────────────────────────┐  │
│  │           Gazebo Classic 11 Simulation                │  │
│  │     6x TurtleBot3 Burger AGVs — aria_warehouse.world │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### ROS2 Topics
| Topic | Type | Description |
|---|---|---|
| `/aria/telemetry` | `std_msgs/String` | Full fleet JSON broadcast every 2s |
| `/aria/mission` | `std_msgs/String` | Mission dispatch from dashboard |
| `/agv_XX/cmd_vel` | `geometry_msgs/Twist` | Velocity commands to each robot |
| `/agv_XX/odom` | `nav_msgs/Odometry` | Real Gazebo position feedback |
| `/agv_XX/status` | `std_msgs/String` | Individual robot status |

---

## 📁 Repository Structure

```
aria-fleet-commander/
│
├── aria-dashboard/                 # React frontend (Mac)
│   ├── src/
│   │   └── App.jsx                 # Main dashboard component
│   ├── .env                        # WS + API URLs
│   └── package.json
│
├── aria-backend/                   # FastAPI backend (Mac)
│   ├── app/
│   │   ├── main.py                 # API routes + rosbridge publisher
│   │   └── agents/
│   │       └── aria_agent.py       # AI agent (Groq/Claude)
│   ├── .env                        # API keys
│   └── requirements.txt
│
├── aria-ros2/                      # ROS2 workspace (GCP VM)
│   └── src/
│       └── aria_fleet/
│           ├── aria_fleet/
│           │   └── fleet_manager.py  # Main ROS2 node
│           ├── launch/
│           │   └── warehouse_sim.launch.py
│           └── setup.py
│
├── worlds/
│   └── aria_warehouse.world        # Custom Gazebo world (no obstacles)
│
├── docs/
│   └── STARTUP_COMMANDS.sh         # Full startup reference
│
└── README.md
```

---

## 🚀 Setup

### Prerequisites
- **Mac** with Homebrew, Node.js 18+, Python 3.10+
- **GCP VM** — Ubuntu 22.04, e2-standard-4 (4 vCPU, 16GB RAM)
- **ROS2 Humble** installed on GCP VM
- **Gazebo Classic 11** installed on GCP VM
- **Groq API key** (free at [console.groq.com](https://console.groq.com)) or Anthropic API key

---

### 1. Clone the Repo

```bash
git clone https://github.com/YOUR_USERNAME/aria-fleet-commander.git
cd aria-fleet-commander
```

---

### 2. Mac — Dashboard Setup

```bash
cd aria-dashboard
npm install
```

Create `.env`:
```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://YOUR_GCP_VM_IP:9090
```

---

### 3. Mac — Backend Setup

```bash
cd aria-backend
pip3 install fastapi uvicorn groq websockets
```

Create `.env`:
```env
GROQ_API_KEY=your_groq_key_here
```

---

### 4. GCP VM — ROS2 Package Setup

```bash
# SSH into VM
gcloud compute ssh YOUR_USERNAME@aria-sim --zone YOUR_ZONE

# Copy aria_warehouse.world
cp worlds/aria_warehouse.world ~/aria_warehouse.world

# Copy fleet manager
cp aria-ros2/src/aria_fleet/aria_fleet/fleet_manager.py \
   ~/aria_ros2/src/aria_fleet/aria_fleet/fleet_manager.py

# Build
cd ~/aria_ros2
colcon build --symlink-install
source install/setup.bash
```

---

### 5. GCP VM — Firewall Rules

```bash
gcloud compute firewall-rules create aria-ros \
  --allow tcp:9090,tcp:8765,tcp:11311 \
  --source-ranges 0.0.0.0/0

gcloud compute firewall-rules create aria-vnc \
  --allow tcp:5900 \
  --source-ranges 0.0.0.0/0
```

---

## ▶️ Running ARIA

### Step 1 — Start VM Simulation

SSH into GCP VM:

```bash
# Virtual display + VNC
Xvfb :99 -screen 0 1280x800x24 &
x11vnc -display :99 -nopw -listen 0.0.0.0 -xkb -forever &

# Environment
export DISPLAY=:99
export LIBGL_ALWAYS_SOFTWARE=1
export TURTLEBOT3_MODEL=burger
export GAZEBO_MODEL_PATH=~/:$GAZEBO_MODEL_PATH
source /opt/ros/humble/setup.bash
source ~/aria_ros2/install/setup.bash

# Start Gazebo
gzserver --verbose ~/aria_warehouse.world \
  -s libgazebo_ros_init.so \
  -s libgazebo_ros_factory.so &
sleep 12
gzclient --verbose &
sleep 5

# Spawn 6 robots
for i in 1 2 3 4 5 6; do
  x=$(( (i-1) % 3 * 2 ))
  y=$(( (i-1) / 3 * 2 ))
  ros2 run gazebo_ros spawn_entity.py \
    -file ~/turtlebot3_burger/model.sdf \
    -entity agv_0${i} -x ${x}.0 -y ${y}.0 -z 0.01 \
    -robot_namespace /agv_0${i}
  sleep 4
done
```

In a new SSH tab:
```bash
source /opt/ros/humble/setup.bash
source ~/aria_ros2/install/setup.bash
ros2 launch aria_fleet warehouse_sim.launch.py
```

### Step 2 — Start Mac Services

```bash
# Terminal 1 — Backend
cd aria-backend
python3 -m uvicorn app.main:app --reload --port 8000

# Terminal 2 — Dashboard
cd aria-dashboard
npm run dev
```

### Step 3 — Open Dashboard

Navigate to **http://localhost:5173**

You should see:
- 🟢 **ROS LIVE** indicator in top right
- 6 robots on the fleet map
- 3 robots auto-patrolling (ACTIVE)
- Live battery and position updates

---

## 🎮 Usage

### Dispatching a Mission
1. Click **+ NEW MISSION**
2. Fill in hourly target, material type, weight, source zone, destination dock
3. Click **DISPATCH N ROBOTS**
4. Watch idle robots activate and start moving in Gazebo

### Viewing Live Positions
- Fleet Map tab shows real-time robot positions from Gazebo odometry
- Toggle **Show intended paths** to see planned waypoint routes
- Click any robot to inspect its status, battery, and fault

### AI Fault Diagnosis
1. When a fault appears in the Alerts tab, click **Ask ARIA**
2. Or go to **ARIA AI** tab and type your question
3. ARIA knows the current fleet status and active fault codes

### VNC Viewer (Gazebo)
Connect to `YOUR_VM_IP:5900` with RealVNC Viewer to see the live Gazebo simulation.

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Robot Simulation | Gazebo Classic 11 + TurtleBot3 |
| Robot Middleware | ROS2 Humble (Python) |
| WebSocket Bridge | rosbridge_server |
| Backend API | FastAPI + Python |
| AI Agent | Groq (llama3) / Anthropic Claude |
| Frontend | React 18 + Vite |
| Charts | Recharts |
| Cloud | Google Cloud Platform (e2-standard-4) |
| VNC | Xvfb + x11vnc |

---

## 🔧 Configuration

### Switching from Groq to Claude
In `aria-backend/app/agents/aria_agent.py`:
```python
# Change from Groq
import anthropic
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
model = "claude-sonnet-4-20250514"
```

Update `.env`:
```env
ANTHROPIC_API_KEY=your_key_here
```

### Adding More Robots
In `fleet_manager.py`, extend `WAYPOINTS` dict and update the robot creation loop from `range(1, 7)` to `range(1, N+1)`.

---

## 📝 Notes

- VM external IP changes on every restart — update `.env` and `main.py` with new IP
- Use `gcloud compute instances start/stop aria-sim --zone us-west2-a` to manage VM costs
- The `--symlink-install` flag in colcon means fleet_manager.py edits apply without rebuilding
- LIDAR visualization can be disabled by setting `<visualize>false</visualize>` in the robot SDF

---

## 👤 Author

**Yash Savle**  
Built as a robotics + AI portfolio project demonstrating ROS2, simulation, real-time dashboards, and LLM integration.

---

## 📄 License

MIT License — feel free to use, modify, and build on this project.
