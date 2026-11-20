"""Regression check for the sim-desk scheduled automation trigger.

This uses only the standard library so it runs on GitHub-hosted runners
without an extra package or network request.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "sim-strategies.yml"
EXPECTED_CRON = "5,35 * * * *"


class WorkflowScheduleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.events = cls.workflow.split("\npermissions:", 1)[0]

    def test_schedule_trigger_is_declared_under_workflow_events(self):
        expected = f'  schedule:\n    - cron: "{EXPECTED_CRON}"'
        self.assertIn(expected, self.events)

    def test_schedule_has_a_30_minute_cadence_offset_from_hour_boundary(self):
        minutes, hours, day_of_month, month, day_of_week = EXPECTED_CRON.split()
        self.assertEqual((hours, day_of_month, month, day_of_week), ("*", "*", "*", "*"))
        offsets = [int(value) for value in minutes.split(",")]
        self.assertEqual(offsets, [5, 35])
        self.assertEqual((offsets[1] - offsets[0]) % 60, 30)
        self.assertNotIn(0, offsets)

    def test_run_is_disclosed_as_best_effort_and_simulated_only(self):
        self.assertIn("best-effort", self.workflow.lower())
        self.assertIn("no credentials, no orders", self.workflow.lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
