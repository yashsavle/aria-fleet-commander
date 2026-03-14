# ═══════════════════════════════════════════════════════════════════
#  ARIA — Complete Startup & Update Guide
#  Follow each section in order. Copy-paste entire blocks.
# ═══════════════════════════════════════════════════════════════════

# ───────────────────────────────────────────────────────────────────
# STEP 1 — UPDATE FILES ON YOUR MAC
# Run these in your Mac terminal
# ───────────────────────────────────────────────────────────────────

# 1a. Copy new App.jsx to dashboard
cp ~/Downloads/App.jsx ~/aria/aria-dashboard/src/App.jsx

# 1b. Copy new main.py to backend
cp ~/Downloads/main.py ~/aria/aria-backend/app/main.py

# 1c. Install websockets package (needed for rosbridge dispatch)
pip3 install websockets

# ───────────────────────────────────────────────────────────────────
# STEP 2 — UPDATE FILES ON GCP VM
# SSH into VM first:
#   gcloud compute ssh yashsavle@aria-sim --zone us-west2-a
# ───────────────────────────────────────────────────────────────────

# 2a. Copy new fleet manager
# Run this on your MAC to upload the file to the VM:
gcloud compute scp ~/Downloads/fleet_manager.py yashsavle@aria-sim:~/aria_ros2/src/aria_fleet/aria_fleet/fleet_manager.py --zone us-west2-a

# 2b. Copy new warehouse world file to VM:
gcloud compute scp ~/Downloads/aria_warehouse.world yashsavle@aria-sim:~/aria_warehouse.world --zone us-west2-a

# 2c. On VM — rebuild ROS2 package:
cd ~/aria_ros2
colcon build --symlink-install
source install/setup.bash

# ───────────────────────────────────────────────────────────────────
# STEP 3 — START GCP VM SIMULATION
# SSH into VM and run these one by one
# ───────────────────────────────────────────────────────────────────

# 3a. Start virtual display
Xvfb :99 -screen 0 1280x800x24 &
sleep 2

# 3b. Start VNC server
x11vnc -display :99 -nopw -listen 0.0.0.0 -xkb -forever &
sleep 2

# 3c. Set all environment variables
export DISPLAY=:99
export LIBGL_ALWAYS_SOFTWARE=1
export TURTLEBOT3_MODEL=burger
export GAZEBO_MODEL_PATH=/opt/ros/humble/share/turtlebot3_gazebo/models:$GAZEBO_MODEL_PATH
source /opt/ros/humble/setup.bash
source ~/aria_ros2/install/setup.bash

# 3d. Start Gazebo with ARIA warehouse world (no green obstacles!)
gzserver --verbose ~/aria_warehouse.world \
  -s libgazebo_ros_init.so \
  -s libgazebo_ros_factory.so &
sleep 12

# 3e. Start Gazebo GUI (visible in VNC Viewer)
gzclient --verbose &
sleep 5

# 3f. Spawn all 6 robots (run one by one, wait for each to finish)
source /opt/ros/humble/setup.bash
ros2 run gazebo_ros spawn_entity.py -file /opt/ros/humble/share/turtlebot3_gazebo/models/turtlebot3_burger/model.sdf -entity agv_01 -x 0.0 -y 0.0 -z 0.01 -robot_namespace /agv_01
sleep 4
ros2 run gazebo_ros spawn_entity.py -file /opt/ros/humble/share/turtlebot3_gazebo/models/turtlebot3_burger/model.sdf -entity agv_02 -x 2.0 -y 0.0 -z 0.01 -robot_namespace /agv_02
sleep 4
ros2 run gazebo_ros spawn_entity.py -file /opt/ros/humble/share/turtlebot3_gazebo/models/turtlebot3_burger/model.sdf -entity agv_03 -x 4.0 -y 0.0 -z 0.01 -robot_namespace /agv_03
sleep 4
ros2 run gazebo_ros spawn_entity.py -file /opt/ros/humble/share/turtlebot3_gazebo/models/turtlebot3_burger/model.sdf -entity agv_04 -x 0.0 -y 2.0 -z 0.01 -robot_namespace /agv_04
sleep 4
ros2 run gazebo_ros spawn_entity.py -file /opt/ros/humble/share/turtlebot3_gazebo/models/turtlebot3_burger/model.sdf -entity agv_05 -x 2.0 -y 2.0 -z 0.01 -robot_namespace /agv_05
sleep 4
ros2 run gazebo_ros spawn_entity.py -file /opt/ros/humble/share/turtlebot3_gazebo/models/turtlebot3_burger/model.sdf -entity agv_06 -x 4.0 -y 2.0 -z 0.01 -robot_namespace /agv_06
sleep 4

# 3g. Open new SSH tab and start fleet manager + rosbridge
gcloud compute ssh yashsavle@aria-sim --zone us-west2-a
source /opt/ros/humble/setup.bash
source ~/aria_ros2/install/setup.bash
export TURTLEBOT3_MODEL=burger
ros2 launch aria_fleet warehouse_sim.launch.py

# ───────────────────────────────────────────────────────────────────
# STEP 4 — SET ISOMETRIC VIEW IN GAZEBO
# Do this in VNC Viewer after Gazebo opens
# ───────────────────────────────────────────────────────────────────
# In Gazebo window:
# 1. Click View menu → Orbit View
# 2. Hold Ctrl + drag mouse to rotate to isometric angle
# 3. Or press: Camera → Top for top-down bird's eye view
# 4. Scroll wheel to zoom until all 6 robots are visible
# Best isometric: rotate ~45° horizontal, ~30° vertical

# ───────────────────────────────────────────────────────────────────
# STEP 5 — START MAC SERVICES
# Run in separate Mac terminal tabs
# ───────────────────────────────────────────────────────────────────

# Tab 1 — Backend
cd ~/aria/aria-backend
python3 -m uvicorn app.main:app --reload --port 8000

# Tab 2 — Dashboard
cd ~/aria/aria-dashboard
npm run dev

# ───────────────────────────────────────────────────────────────────
# STEP 6 — VERIFY EVERYTHING IS CONNECTED
# ───────────────────────────────────────────────────────────────────

# Check rosbridge from Mac:
npx wscat -c ws://35.236.17.72:9090

# Check backend health:
curl http://localhost:8000/health

# Open dashboard:
# http://localhost:5173
# You should see ROS LIVE (green) in top right
# Robots should appear on the map with live positions

# ───────────────────────────────────────────────────────────────────
# STEP 7 — TEST MISSION DISPATCH
# ───────────────────────────────────────────────────────────────────
# 1. Open dashboard at http://localhost:5173
# 2. Click "+ NEW MISSION"
# 3. Fill in:
#    - Hourly Target: 40
#    - Material Type: Auto Parts
#    - Weight: 25
#    - Source: Zone A
#    - Dock: Dock 1
# 4. Click "DISPATCH 3 ROBOTS"
# 5. Watch Gazebo — idle robots should activate and start moving
# 6. Watch dashboard map — robots status changes to ACTIVE

# ───────────────────────────────────────────────────────────────────
# SHUTDOWN (end of session)
# ───────────────────────────────────────────────────────────────────

# On VM:
pkill -9 -f gazebo; pkill -9 -f gzserver; pkill -9 -f gzclient
pkill -f ros2; pkill -f rosbridge; pkill -f x11vnc; pkill -f Xvfb

# On Mac: Ctrl+C in each terminal tab

# Stop VM to save credits:
gcloud compute instances stop aria-sim --zone us-west2-a
