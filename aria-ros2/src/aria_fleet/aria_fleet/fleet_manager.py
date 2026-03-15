#!/usr/bin/env python3
import rclpy, json, random, math
from rclpy.node import Node
from geometry_msgs.msg import Twist
from std_msgs.msg import String
from nav_msgs.msg import Odometry

# ── Simple warehouse layout ───────────────────────────────────────────────
ZONE_PICKUP = {
    "Zone A": [{"x": 1.5, "y": 13.0}, {"x": 2.5, "y": 13.0}],
    "Zone B": [{"x": 9.5, "y": 13.0}, {"x": 10.5, "y": 13.0}],
    "Zone C": [{"x": 17.5, "y": 13.0}, {"x": 18.5, "y": 13.0}],
}

# Each AGV has its own fixed lane on X axis to avoid collisions
AGV_LANES = {
    "agv_01": 1.0,
    "agv_02": 2.0,
    "agv_03": 3.0,
    "agv_04": 4.0,
    "agv_05": 5.0,
    "agv_06": 6.0,
}

# Conveyor dropoff — each AGV drops at its lane X
CONVEYOR_Y = 2.5

# Staging return Y
STAGING_Y = 4.5

FAULT_POOL = ["ENC_ERR_04", "BATT_CELL_FAIL", "NAV_STUCK", "ESTOP_TRIGGERED", "MOTOR_OVERTEMP"]
UNITS_PER_AGV_PER_HOUR = 15


def angle_diff(a, b):
    d = a - b
    while d >  math.pi: d -= 2 * math.pi
    while d < -math.pi: d += 2 * math.pi
    return d


class AGVRobot:
    def __init__(self, robot_id, node):
        self.id       = robot_id
        self.node     = node
        self.lane_x   = AGV_LANES[robot_id]

        self.status   = "idle"
        self.state    = "staging"
        self.battery  = 100.0
        self.task     = "Standby"
        self.fault    = None
        self.zone     = None
        self.carrying = False

        # Start position
        self.x        = self.lane_x
        self.y        = STAGING_Y
        self.heading  = 0.0

        self.target_x = self.lane_x
        self.target_y = STAGING_Y
        self.waypoints = []
        self.dwell    = 0

        self.cmd_pub  = node.create_publisher(Twist,  f"/{robot_id}/cmd_vel", 10)
        self.stat_pub = node.create_publisher(String, f"/{robot_id}/status",  10)
        node.create_subscription(Odometry, f"/{robot_id}/odom", self._odom, 10)

    def _odom(self, msg):
        self.x = round(msg.pose.pose.position.x, 3)
        self.y = round(msg.pose.pose.position.y, 3)
        q = msg.pose.pose.orientation
        self.heading = math.atan2(
            2*(q.w*q.z + q.x*q.y),
            1 - 2*(q.y*q.y + q.z*q.z))

    def assign(self, zone, pickup_idx=0):
        self.zone    = zone
        self.status  = "active"
        self.state   = "to_pickup"
        self.task    = f"Heading to {zone}"
        picks        = ZONE_PICKUP[zone]
        pick         = picks[pickup_idx % len(picks)]

        # Path: staging → lane corridor → pickup → conveyor lane → conveyor → return
        self.waypoints = [
            # Move up the lane first (avoid crossing other AGVs)
            {"x": self.lane_x, "y": 10.0,        "action": "none"},
            {"x": pick["x"],   "y": pick["y"],    "action": "pickup"},
            {"x": pick["x"],   "y": 10.0,         "action": "none"},
            {"x": self.lane_x, "y": CONVEYOR_Y,   "action": "dropoff"},
            {"x": self.lane_x, "y": STAGING_Y,    "action": "stage"},
        ]
        self._next_wp()

    def _next_wp(self):
        if self.waypoints:
            wp = self.waypoints[0]
            self.target_x = wp["x"]
            self.target_y = wp["y"]

    def navigate(self):
        twist = Twist()
        if self.status != "active":
            self.cmd_pub.publish(twist)
            return
        if self.dwell > 0:
            self.dwell -= 1
            self.cmd_pub.publish(twist)
            return
        if not self.waypoints:
            self.cmd_pub.publish(twist)
            return

        dist = math.sqrt((self.target_x-self.x)**2 + (self.target_y-self.y)**2)
        if dist < 0.35:
            self._arrive()
            self.cmd_pub.publish(twist)
            return

        angle   = math.atan2(self.target_y-self.y, self.target_x-self.x)
        ang_err = angle_diff(angle, self.heading)
        twist.angular.z = max(-0.8, min(0.8, 1.5*ang_err))
        twist.linear.x  = 0.35 if abs(ang_err) < 0.4 else 0.05
        self.cmd_pub.publish(twist)

    def _arrive(self):
        wp = self.waypoints.pop(0)
        action = wp.get("action", "none")

        if action == "pickup":
            self.state    = "picking"
            self.task     = f"Loading at {self.zone}"
            self.carrying = True
            self.dwell    = 30
            self.node.get_logger().info(f"📦 {self.id} picking at {self.zone}")

        elif action == "dropoff":
            self.state    = "delivering"
            self.task     = "Dropping at conveyor"
            self.carrying = False
            self.dwell    = 20
            self.node.get_logger().info(f"📤 {self.id} dropped on conveyor")

        elif action == "stage":
            self.state    = "staging"
            self.status   = "idle"
            self.task     = "Standby"
            self.zone     = None
            self.carrying = False
            self.node.get_logger().info(f"🅿 {self.id} back in staging")

        if self.waypoints:
            self._next_wp()

    def pub_status(self):
        msg = String()
        msg.data = json.dumps({
            "id": self.id, "status": self.status, "state": self.state,
            "battery": round(self.battery,1), "task": self.task,
            "fault": self.fault, "zone": self.zone,
            "x": round(self.x,3), "y": round(self.y,3),
            "carrying": self.carrying,
        })
        self.stat_pub.publish(msg)


class ARIAFleetManager(Node):
    def __init__(self):
        super().__init__("aria_fleet_manager")
        self.robots = {
            f"agv_0{i}": AGVRobot(f"agv_0{i}", self)
            for i in range(1, 7)
        }
        self.pickup_counter = 0

        self.create_subscription(String, "/aria/mission",      self.on_mission,      10)
        self.create_subscription(String, "/aria/inject_fault", self.on_fault,        10)
        self.telemetry_pub = self.create_publisher(String, "/aria/telemetry", 10)

        self.create_timer(0.1, self.move)
        self.create_timer(1.0, self.update)
        self.create_timer(2.0, self.broadcast)

        self.get_logger().info("ARIA Fleet Manager v3 — 6 AGVs idle ✅")
        self.get_logger().info("Waiting for mission dispatch...")

    def on_mission(self, msg):
        try:
            m = json.loads(msg.data)
        except:
            return

        material  = m.get("material_type", m.get("material", ""))
        source    = m.get("source", "Zone A")
        target    = int(m.get("hourly_target", 30))
        needed    = max(1, min(4, math.ceil(target / UNITS_PER_AGV_PER_HOUR)))

        zone = source
        ml   = material.lower()
        if "auto" in ml or "parts" in ml:         zone = "Zone A"
        elif "elec" in ml:                          zone = "Zone B"
        elif "raw"  in ml or "material" in ml:      zone = "Zone C"

        idle      = [r for r in self.robots.values() if r.status == "idle"]
        activated = []
        for i, r in enumerate(idle[:needed]):
            r.assign(zone, self.pickup_counter % 2)
            self.pickup_counter += 1
            activated.append(r.id)

        self.get_logger().info(f"✅ {zone} | {target} u/hr | {activated}")

    def on_fault(self, msg):
        data = msg.data.strip()
        targets = []
        if data.startswith("random:"):
            n      = int(data.split(":")[1])
            active = [r for r in self.robots.values() if r.status == "active"]
            targets = random.sample(active, min(n, len(active)))
        else:
            for rid in data.split(","):
                rid = rid.strip()
                if rid in self.robots:
                    targets.append(self.robots[rid])

        for r in targets:
            r.status   = "fault"
            r.fault    = random.choice(FAULT_POOL)
            r.state    = "staging"
            r.task     = f"FAULT: {r.fault}"
            r.waypoints = []
            r.carrying  = False
            self.get_logger().warn(f"⚠ {r.id}: {r.fault}")

    def move(self):
        for r in self.robots.values():
            r.navigate()

    def update(self):
        for r in self.robots.values():
            if r.status == "active":
                r.battery = max(0.0, r.battery - 0.04)
                if r.battery < 15:
                    r.status   = "charging"
                    r.state    = "staging"
                    r.task     = "Charging"
                    r.waypoints = []
            elif r.status == "charging":
                r.battery = min(100.0, r.battery + 0.8)
                if r.battery >= 100:
                    r.status = "idle"
                    r.task   = "Standby"
            r.pub_status()

    def broadcast(self):
        fleet = {
            rid: {
                "status": r.status, "state": r.state,
                "battery": round(r.battery,1), "task": r.task,
                "fault": r.fault, "zone": r.zone,
                "x": round(r.x,3), "y": round(r.y,3),
                "carrying": r.carrying,
            }
            for rid, r in self.robots.items()
        }
        msg = String()
        msg.data = json.dumps(fleet)
        self.telemetry_pub.publish(msg)


def main():
    rclpy.init()
    node = ARIAFleetManager()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == "__main__":
    main()
