import anthropic
import json
import os
from dotenv import load_dotenv

load_dotenv()

FAULT_GUIDE = {
    "ENC_ERR_04":      "Motor encoder feedback lost — reseat encoder cable, clean optical disk, verify 4.7k ohm pull-up resistance on signal line",
    "BATT_CELL_FAIL":  "Battery cell failure detected — replace affected module, review BMS charge logs, check cell voltage delta",
    "LIDAR_TIMEOUT":   "LIDAR scan timeout — power cycle sensor, verify USB/Ethernet connection, check for lens obstruction",
    "ESTOP_TRIGGERED": "Emergency stop activated — clear obstruction from robot path, reset E-stop button, perform visual inspection before resuming",
    "NAV_STUCK":       "Navigation stack failure — clear immediate path, restart Nav2 stack, verify map is current and obstacle costmap is clear",
    "MOTOR_OVERTEMP":  "Drive motor overheating — stop robot immediately, check cooling fan operation, reduce duty cycle, inspect for mechanical resistance",
}


class ARIAAgent:
    def __init__(self):
        self.client = anthropic.Anthropic(
            api_key=os.getenv("ANTHROPIC_API_KEY")
        )

    async def answer(self, question: str, context: dict) -> str:
        faults     = context.get("faults", [])
        robots     = context.get("robots", {})
        fault_info = json.dumps(FAULT_GUIDE, indent=2)

        system = f"""You are ARIA, an expert AI system for warehouse AGV fleet operations.

Current fleet state:
{json.dumps(robots, indent=2)}

Active fault alerts:
{json.dumps(faults, indent=2)}

Fault reference database:
{fault_info}

Guidelines:
- Be direct and technical. Warehouse engineers need actionable information.
- Always lead with safety (lockout/tagout) before repair steps.
- Use numbered steps for any procedure.
- If asked about robot counts or throughput, show your calculation clearly.
- Keep responses concise — under 300 words unless a detailed procedure is needed."""

        response = self.client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            system=system,
            messages=[{"role": "user", "content": question}]
        )
        return response.content[0].text

    def dispatch(self, mission: dict) -> list:
        target        = mission.get("hourly_target", 30)
        robots_needed = max(1, min(6, target // 15))
        return [f"AGV-{i+1:02d}" for i in range(robots_needed)]
