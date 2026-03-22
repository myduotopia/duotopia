"""
Load Testing Configuration
Supports PROD (VM) and Staging (Cloud Run) environments
"""

import os
from typing import Literal
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass
class LoadTestConfig:
    """Configuration for load testing environments"""

    name: str
    base_url: str
    # Authentication credentials
    teacher_email: str
    teacher_password: str
    student_email: str
    student_password: str
    # Test parameters
    max_file_size_mb: float = 2.0
    upload_timeout_seconds: int = 30
    # Performance thresholds
    max_acceptable_latency_p95: int = 10  # seconds
    max_error_rate_percent: float = 5.0
    # Database monitoring (optional)
    database_url: str = None


# Environment configurations
ENVIRONMENTS = {
    "staging": LoadTestConfig(
        name="Staging (Cloud Run)",
        base_url=os.getenv(
            "STAGING_BASE_URL",
            "https://duotopia-staging-backend-316409492201.asia-east1.run.app",
        ),
        teacher_email=os.getenv("TEST_TEACHER_EMAIL", "test-teacher@duotopia.co"),
        teacher_password=os.getenv("TEST_TEACHER_PASSWORD", "test-password"),
        student_email=os.getenv("TEST_STUDENT_EMAIL", "test-student@duotopia.co"),
        student_password=os.getenv("TEST_STUDENT_PASSWORD", "test-password"),
        database_url=os.getenv("STAGING_DATABASE_URL"),
        # Staging has lower resources
        max_acceptable_latency_p95=15,  # More lenient
    ),
    "production": LoadTestConfig(
        name="Production (VM)",
        base_url=os.getenv("PRODUCTION_BASE_URL", "https://duotopia.co"),
        teacher_email=os.getenv("PROD_TEST_TEACHER_EMAIL", "load-test@duotopia.co"),
        teacher_password=os.getenv("PROD_TEST_TEACHER_PASSWORD", "load-test-password"),
        student_email=os.getenv(
            "PROD_TEST_STUDENT_EMAIL", "load-test-student@duotopia.co"
        ),
        student_password=os.getenv("PROD_TEST_STUDENT_PASSWORD", "load-test-password"),
        database_url=os.getenv("PRODUCTION_DATABASE_URL"),
        # Production should be faster
        max_acceptable_latency_p95=10,
    ),
    "local": LoadTestConfig(
        name="Local Development",
        base_url="http://localhost:8080",
        teacher_email="teacher@example.com",
        teacher_password="password123",
        student_email="student@example.com",
        student_password="password123",
        database_url=os.getenv(
            "DATABASE_URL",
            "postgresql://duotopia_user:duotopia_pass@localhost:5432/duotopia",
        ),
    ),
}


def get_config(
    env: Literal["staging", "production", "local"] = "staging"
) -> LoadTestConfig:
    """
    Get configuration for specified environment

    Args:
        env: Environment name (staging/production/local)

    Returns:
        LoadTestConfig for the environment
    """
    if env not in ENVIRONMENTS:
        raise ValueError(
            f"Unknown environment: {env}. Must be one of {list(ENVIRONMENTS.keys())}"
        )

    config = ENVIRONMENTS[env]

    # Validate required credentials
    if not config.teacher_email or not config.teacher_password:
        raise ValueError(f"Missing teacher credentials for {env} environment")
    if not config.student_email or not config.student_password:
        raise ValueError(f"Missing student credentials for {env} environment")

    return config


# Test scenario configurations
class TestScenarios:
    """Predefined load test scenarios"""

    NORMAL_LOAD = {
        "name": "Normal Load",
        "description": "Typical usage pattern",
        "users": 20,
        "spawn_rate": 2,  # users/second
        "duration": "5m",
        "expected_rps": 10,  # requests per second
    }

    PEAK_LOAD = {
        "name": "Peak Load",
        "description": "High traffic period (e.g., after homework assignment)",
        "users": 50,
        "spawn_rate": 5,
        "duration": "5m",
        "expected_rps": 25,
    }

    STRESS_TEST = {
        "name": "Stress Test",
        "description": "Push system beyond normal capacity",
        "users": 100,
        "spawn_rate": 10,
        "duration": "10m",
        "expected_rps": 50,
    }

    SPIKE_TEST = {
        "name": "Spike Test",
        "description": "Sudden traffic burst",
        "users": 50,
        "spawn_rate": 50,  # All users at once
        "duration": "3m",
        "expected_rps": 30,
    }

    ENDURANCE_TEST = {
        "name": "Endurance Test",
        "description": "Sustained load over time",
        "users": 30,
        "spawn_rate": 3,
        "duration": "30m",
        "expected_rps": 15,
    }

    BREAKING_POINT = {
        "name": "Breaking Point",
        "description": "Find system limits",
        "users": 200,
        "spawn_rate": 20,
        "duration": "10m",
        "expected_rps": 100,
    }


# Audio test file configurations
class AudioTestFiles:
    """Test audio file specifications"""

    SMALL = {
        "name": "small",
        "size_kb": 50,
        "duration_seconds": 3,
        "description": "Short phrase (e.g., 'Hello, how are you?')",
    }

    MEDIUM = {
        "name": "medium",
        "size_kb": 200,
        "duration_seconds": 10,
        "description": "Medium sentence recording",
    }

    LARGE = {
        "name": "large",
        "size_kb": 500,
        "duration_seconds": 20,
        "description": "Long recording near limit",
    }

    MAX_SIZE = {
        "name": "max",
        "size_kb": 2000,  # 2MB limit
        "duration_seconds": 30,
        "description": "Maximum allowed size (30 seconds)",
    }


# Monitoring configuration
class MonitoringConfig:
    """Configuration for metrics collection"""

    # Prometheus-style metrics
    ENABLE_PROMETHEUS = (
        os.getenv("ENABLE_PROMETHEUS_METRICS", "false").lower() == "true"
    )
    PROMETHEUS_PORT = int(os.getenv("PROMETHEUS_PORT", "9091"))

    # Database monitoring
    ENABLE_DB_MONITORING = os.getenv("ENABLE_DB_MONITORING", "true").lower() == "true"
    DB_QUERY_INTERVAL = int(os.getenv("DB_QUERY_INTERVAL", "5"))  # seconds

    # Result storage
    RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
    SAVE_RAW_DATA = os.getenv("SAVE_RAW_DATA", "true").lower() == "true"

    # Alerting
    SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
    ALERT_ON_ERROR_RATE = float(
        os.getenv("ALERT_ERROR_RATE_THRESHOLD", "10.0")
    )  # percent
    ALERT_ON_LATENCY_P95 = int(
        os.getenv("ALERT_LATENCY_P95_THRESHOLD", "15")
    )  # seconds
