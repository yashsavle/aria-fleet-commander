#!/usr/bin/env python3
"""
ARIA Fleet Manager — ROS2 Node
Manages 6 AGV robots with waypoint navigation and fault simulation
Reads real positions from Gazebo odometry topics
"""
import rclpy, json, random, math
from rclpy.node import Node
from geometry_msgs.msg import Twist
from std_msgs.msg import String
from nav_msgs.msg import Odometry

FAULT_POOL = [
    "ENC_ERR_04",
    "BATT_CELL_FAIL",
    "LIDAR_TIMEOUT",
    "ESTOP_TRIGGERED",
    "NAV_STUCK",
]

# Waypoints for each robot (patrol routes around warehouse)
WAYPOINTS = {
    "agv_01": [{"x": 0.0,  "y": 0.0},  {"x": 2.0,  "y": 0.0},  {"x": 2.0, "y": 2.0}, {"x": 0.0, "y": 2.0}],
    "agv_02": [{"x": 2.0,  "y": 0.0},  {"x": 4.0,  "y": 0.0},  {"x": 4.0, "y": 2.0}, {"x": 2.0, "y": 2.0}],
    "agv_03": [{"x": 0.0,  "y": 2.0},  {"x": 4.0,  "y": 2.0},  {"x": 4.0, "y": 0.0}, {"x": 0.0, "y": 0.0}],
    "agv_04": [{"x": 1.0,  "y": 1.0},  {"x": 3.0,  "y": 1.0},  {"x": 3.0, "y": 3.0}, {"x": 1.0, "y": 3.0}],
    "agv_05": [{"x": 2.0,  "y": 3.0},  {"x": 4.0,  "y": 3.0},  {"x": 4.0, "y": 1.0}, {"x": 0.0, "y": 1.0}],
    "agv_06": [{"x": 0.0,  "y": 3.0},  {"x": 2.0,  "y": 3.0},  {"x": 4.0, "y": 3.0}, {"x": 2.0, "y": 0.0}],
}


class AGVRobot:
    def __init__(self, robot_id, node):
        self.id           = robot_id
        self.status       = "idle"
        self.battery      = 100.0
        self.task         = "Standby"
        self.fault        = None

        # Position (updated from odometry ideally, estimated here)
        self.x            = WAYPOINTS[robot_id][0]["x"]
        self.y            = WAYPOINTS[robot_id][0]["y"]
        self.heading      = 0.0

        # Waypoint navigation
        self.waypoints    = WAYPOINTS[robot_id]
        self.wp_index     = 0

        # ROS publishers
        self.cmd_pub  = node.create_publisher(Twist, f"/{robot_id}/cmd_vel",  10)
        self.stat_pub = node.create_publisher(String, f"/{robot_id}/status", 10)

        # Subscribe to real Gazebo odometry for accurate positions
        node.create_subscription(
            Odometry, f"/{robot_id}/odom", self._odom_callback, 10)

    def _odom_callback(self, msg):
        """Update position from real Gazebo odometry"""
        self.x = round(msg.pose.pose.position.x, 3)
        self.y = round(msg.pose.pose.position.y, 3)
        # Extract yaw from quaternion
        q = msg.pose.pose.orientation
        siny = 2.0 * (q.w * q.z + q.x * q.y)
        cosy = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
        self.heading = math.atan2(siny, cosy)

    def current_waypoint(self):
        return self.waypoints[self.wp_index]

    def distance_to_waypoint(self):
        wp = self.current_waypoint()
        return math.sqrt((wp["x"] - self.x) ** 2 + (wp["y"] - self.y) ** 2)

    def angle_to_waypoint(self):
        wp = self.current_waypoint()
        return math.atan2(wp["y"] - self.y, wp["x"] - self.x)

    def navigate(self):
        """Compute cmd_vel toward next waypoint"""
        twist = Twist()

        if self.status != "active":
            self.cmd_pub.publish(twist)  # stop
            return

        dist  = self.distance_to_waypoint()
        angle = self.angle_to_waypoint()

        # Advance waypoint when close enough
        if dist < 0.25:
            self.wp_index = (self.wp_index + 1) % len(self.waypoints)
            wp = self.current_waypoint()
            self.x = wp["x"]
            self.y = wp["y"]
            return

        # Angle error
        angle_err = angle - self.heading
        # Normalize to [-pi, pi]
        while angle_err >  math.pi: angle_err -= 2 * math.pi
        while angle_err < -math.pi: angle_err += 2 * math.pi

        # Simple P controller
        twist.angular.z = max(-1.0, min(1.0, 1.8 * angle_err))
        twist.linear.x  = 0.18 if abs(angle_err) < 0.5 else 0.05

        self.cmd_pub.publish(twist)
        # Position is now updated by _odom_callback from real Gazebo odometry

    def publish_status(self):
        msg      = String()
        msg.data = json.dumps({
            "id":      self.id,
            "status":  self.status,
            "battery": round(self.battery, 1),
            "task":    self.task,
            "fault":   self.fault,
            "x":       round(self.x, 3),
            "y":       round(self.y, 3),
        })
        self.stat_pub.publish(msg)


class ARIAFleetManager(Node):
    def __init__(self):
        super().__init__("aria_fleet_manager")

        # Create all 6 robots
        self.robots = {
            f"agv_0{i}": AGVRobot(f"agv_0{i}", self)
            for i in range(1, 7)
        }

        # Subscriptions
        self.create_subscription(String, "/aria/mission", self.on_mission, 10)

        # Publishers
        self.telemetry_pub = self.create_publisher(String, "/aria/telemetry", 10)

        # Timers
        self.create_timer(0.1,  self.send_movement)   # 10 Hz movement
        self.create_timer(1.0,  self.update_status)   # 1 Hz status
        self.create_timer(2.0,  self.broadcast)       # 0.5 Hz telemetry
        self.create_timer(25.0, self.inject_fault)    # random faults

        # Auto-activate 3 robots on startup for demo
        for rid in ["agv_01", "agv_02", "agv_03"]:
            r = self.robots[rid]
            r.status = "active"
            r.task   = "Warehouse patrol route"

        self.get_logger().info("ARIA Fleet Manager — 6 AGVs ready ✅")
        self.get_logger().info("AGV-01, AGV-02, AGV-03 auto-activated on patrol")

    def on_mission(self, msg):
        """Receive mission command from dashboard"""
        try:
            m = json.loads(msg.data)
        except Exception:
            return

        needed = m.get("robots", 2)
        source = m.get("source", "Zone A")
        dock   = m.get("dock",   "Dock 1")

        idle_robots = [r for r in self.robots.values() if r.status == "idle"]
        activated   = []

        for r in idle_robots[:needed]:
            r.status = "active"
            r.task   = f"Picking {source} → {dock}"
            activated.append(r.id)

        self.get_logger().info(
            f"Mission dispatched: {source}→{dock} | Activated: {activated}"
        )

    def send_movement(self):
        """Send velocity commands at 10Hz"""
        for r in self.robots.values():
            r.navigate()

    def update_status(self):
        """Update battery drain and status at 1Hz"""
        for r in self.robots.values():
            if r.status == "active":
                r.battery = max(0.0, r.battery - 0.05)
                if r.battery < 20.0:
                    r.status = "charging"
                    r.task   = "Low battery — returning to charge station"
                    self.get_logger().warn(f"{r.id} battery low — auto charging")
            elif r.status == "charging" and r.battery < 100.0:
                r.battery = min(100.0, r.battery + 0.5)
                if r.battery >= 100.0:
                    r.status = "idle"
                    r.task   = "Standby — fully charged"
            r.publish_status()

    def broadcast(self):
        """Publish full fleet telemetry every 2 seconds"""
        fleet = {
            rid: {
                "status":  r.status,
                "battery": round(r.battery, 1),
                "task":    r.task,
                "fault":   r.fault,
                "x":       round(r.x, 3),
                "y":       round(r.y, 3),
            }
            for rid, r in self.robots.items()
        }
        msg      = String()
        msg.data = json.dumps(fleet)
        self.telemetry_pub.publish(msg)

    def inject_fault(self):
        """Randomly inject a fault for demo purposes"""
        active = [r for r in self.robots.values() if r.status == "active"]
        if active and random.random() < 0.2:
            r        = random.choice(active)
            r.status = "fault"
            r.fault  = random.choice(FAULT_POOL)
            r.task   = f"FAULT: {r.fault}"
            self.get_logger().warn(f"⚠ FAULT on {r.id}: {r.fault}")


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
