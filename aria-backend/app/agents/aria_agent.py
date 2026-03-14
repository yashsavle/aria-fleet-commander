import anthropic, json, os
from dotenv import load_dotenv
load_dotenv()

FAULT_GUIDE = {
  'ENC_ERR_04':      'Motor encoder feedback lost — reseat cable, clean disk, check 4.7k ohm resistance',
  'BATT_CELL_FAIL':  'Battery cell failure — replace module, check BMS logs',
  'LIDAR_TIMEOUT':   'LIDAR scan timeout — restart sensor, check USB/Ethernet connection',
  'ESTOP_TRIGGERED': 'Emergency stop activated — clear obstruction, reset E-stop button',
  'NAV_STUCK':       'Navigation failure — clear path, restart Nav2 stack, remap area',
}

class ARIAAgent:
    def __init__(self):
        self.client = anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))

    async def answer(self, question: str, context: dict) -> str:
        faults = context.get('faults', [])
        robots = context.get('robots', [])
        fault_info = json.dumps(FAULT_GUIDE, indent=2)

        system = f'''You are ARIA, an expert AI agent for warehouse AGV fleet management.
Active faults: {json.dumps(faults)}
Fleet state:   {json.dumps(robots)}
Fault database:{fault_info}

Be concise and technical. Use numbered steps for repairs.
Always mention safety first (lockout/tagout procedures).'''

        response = self.client.messages.create(
            model='claude-sonnet-4-20250514',
            max_tokens=1000,
            system=system,
            messages=[{'role': 'user', 'content': question}]
        )
        return response.content[0].text

    def dispatch(self, mission: dict) -> list:
        target    = mission.get('hourly_target', 30)
        weight    = mission.get('weight_kg', 25)
        robots_needed = max(1, min(6, target // 15))
        return [f'AGV-{i+1:02d}' for i in range(robots_needed)]
