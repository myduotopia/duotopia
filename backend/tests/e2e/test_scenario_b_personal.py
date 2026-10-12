#!/usr/bin/env python3
"""
E2E Test - Scenario B: Personal Student → Teacher Quota
Tests that speech assessments for personal students deduct from teacher quota, NOT org points.
"""

import io
import json
import math
import os
import struct
import time
import wave
from typing import Optional

import requests

# Configuration
BASE_URL = "https://duotopia-preview-issue-208-backend-b2ovkkgl6a-de.a.run.app"
ORG_ID = "21a8a0c7-a5e3-4799-8336-fbb2cf1de91a"

# Test users
DEMO_PASSWORD = os.environ.get("SEED_DEFAULT_PASSWORD", "demo123")
DEMO_TEACHER = {"email": "demo@duotopia.com", "password": DEMO_PASSWORD}
ORG_OWNER = {"email": "owner@duotopia.com", "password": DEMO_PASSWORD}

RATE_LIMIT_WAIT = 22  # seconds between logins


def generate_wav(duration: float = 2.0, freq: float = 440.0) -> bytes:
    """Generate a WAV file with sine wave."""
    sr = 16000
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        frames = bytearray()
        for i in range(int(sr * duration)):
            s = int(16000 * math.sin(2 * math.pi * freq * i / sr))
            frames.extend(struct.pack("<h", s))
        wf.writeframes(bytes(frames))
    return buf.getvalue()


def login_teacher(email: str, password: str) -> Optional[str]:
    """Login as teacher and return access token."""
    try:
        resp = requests.post(
            f"{BASE_URL}/api/auth/teacher/login",
            json={"email": email, "password": password},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()["access_token"]
    except Exception as e:
        print(f"❌ Login failed for {email}: {e}")
        return None


def login_student(student_id: int, password: str) -> Optional[str]:
    """Login as student and return access token."""
    try:
        resp = requests.post(
            f"{BASE_URL}/api/auth/student/login",
            json={"id": student_id, "password": password},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()["access_token"]
    except Exception as e:
        print(f"❌ Student login failed: {e}")
        return None


def get_teacher_quota(token: str) -> Optional[dict]:
    """Get teacher subscription quota."""
    try:
        resp = requests.get(
            f"{BASE_URL}/api/teachers/subscription",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        # Response is nested: {"subscription_period": {"quota_total": ..., "quota_used": ...}}
        period = data.get("subscription_period") or {}
        result = {
            "quota_total": period.get("quota_total", 0),
            "quota_used": period.get("quota_used", 0),
        }
        print(f"  Raw subscription response: {json.dumps(data, default=str)[:200]}")
        return result
    except Exception as e:
        print(f"❌ Get quota failed: {e}")
        return None


def get_org_points(token: str, org_id: str) -> Optional[int]:
    """Get organization points."""
    try:
        resp = requests.get(
            f"{BASE_URL}/api/organizations/{org_id}/points",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("used_points", 0)
    except Exception as e:
        print(f"❌ Get org points failed: {e}")
        return None


def main():
    print("═" * 60)
    print("E2E TEST - SCENARIO B: Personal Student → Teacher Quota")
    print("═" * 60)
    print()

    # Step 1: Give demo@duotopia.com a subscription
    print("Step 1: Setting up demo@duotopia.com subscription...")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/test/subscription/update",
            json={"action": "set_subscribed", "email": DEMO_TEACHER["email"]},
            timeout=10,
        )
        resp.raise_for_status()
        print("✅ Subscription set (quota_total=2000, quota_used=0)")
    except Exception as e:
        print(f"❌ Set subscription failed: {e}")
        return

    print()

    # Step 2: Login as demo@duotopia.com and get quota BEFORE
    print("Step 2: Recording teacher quota BEFORE...")
    demo_token = login_teacher(DEMO_TEACHER["email"], DEMO_TEACHER["password"])
    if not demo_token:
        return

    quota_before = get_teacher_quota(demo_token)
    if quota_before is None:
        return
    print(f"✅ Teacher quota BEFORE: {quota_before['quota_used']}")
    print()

    # Step 3: Record org points BEFORE
    print("Step 3: Recording org points BEFORE...")
    print(f"⏳ Waiting {RATE_LIMIT_WAIT}s for rate limit...")
    time.sleep(RATE_LIMIT_WAIT)

    owner_token = login_teacher(ORG_OWNER["email"], ORG_OWNER["password"])
    if not owner_token:
        return

    org_points_before = get_org_points(owner_token, ORG_ID)
    if org_points_before is None:
        return
    print(f"✅ Org points BEFORE: {org_points_before}")
    print()

    # Step 4: Create personal classroom under demo@duotopia.com
    print("Step 4: Creating personal classroom...")
    print(f"⏳ Waiting {RATE_LIMIT_WAIT}s for rate limit...")
    time.sleep(RATE_LIMIT_WAIT)

    demo_token = login_teacher(DEMO_TEACHER["email"], DEMO_TEACHER["password"])
    if not demo_token:
        return

    try:
        resp = requests.post(
            f"{BASE_URL}/api/teachers/classrooms",
            headers={"Authorization": f"Bearer {demo_token}"},
            json={"name": "E2E Personal Class", "level": "A1", "grade": 3},
            timeout=10,
        )
        resp.raise_for_status()
        classroom_id = resp.json()["id"]
        print(f"✅ Created classroom: {classroom_id}")
    except Exception as e:
        print(f"❌ Create classroom failed: {e}")
        return

    print()

    # Step 5: Create student in personal classroom
    print("Step 5: Creating student in personal classroom...")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/teachers/students",
            headers={"Authorization": f"Bearer {demo_token}"},
            json={
                "name": "E2E小明",
                "birthdate": "2010-06-15",
                "classroom_id": classroom_id,
            },
            timeout=10,
        )
        resp.raise_for_status()
        student_data = resp.json()
        student_id = student_data["id"]
        student_password = os.environ.get("SEED_DEFAULT_PASSWORD", "20100615")
        print(f"✅ Created student: {student_id} (password: {student_password})")
    except Exception as e:
        print(f"❌ Create student failed: {e}")
        return

    print()

    # Step 6: Find content for assignment
    print("Step 6: Finding content for assignment...")
    try:
        resp = requests.get(
            f"{BASE_URL}/api/teachers/programs",
            headers={"Authorization": f"Bearer {demo_token}"},
            timeout=10,
        )
        resp.raise_for_status()
        programs = resp.json()
        if not programs:
            print("❌ No programs found")
            return

        program_id = programs[0]["id"]
        print(f"  Found program: {program_id}")

        resp = requests.get(
            f"{BASE_URL}/api/teachers/programs/{program_id}",
            headers={"Authorization": f"Bearer {demo_token}"},
            timeout=10,
        )
        resp.raise_for_status()
        lessons = resp.json().get("lessons", [])
        if not lessons:
            print("❌ No lessons found")
            return

        lesson_id = lessons[0]["id"]
        print(f"  Found lesson: {lesson_id}")

        resp = requests.get(
            f"{BASE_URL}/api/teachers/lessons/{lesson_id}/contents",
            headers={"Authorization": f"Bearer {demo_token}"},
            timeout=10,
        )
        resp.raise_for_status()
        contents = resp.json()
        if not contents:
            print("❌ No contents found")
            return

        # Prefer reading content, fallback to any
        content_id = None
        for c in contents:
            if c.get("type") in ["reading", "reading_assessment"]:
                content_id = c["id"]
                break
        if not content_id:
            content_id = contents[0]["id"]

        print(f"✅ Found content: {content_id}")
    except Exception as e:
        print(f"❌ Find content failed: {e}")
        return

    print()

    # Step 7: Create assignment
    print("Step 7: Creating assignment...")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/teachers/assignments/create",
            headers={"Authorization": f"Bearer {demo_token}"},
            json={
                "title": "E2E Speech Test",
                "classroom_id": classroom_id,
                "content_ids": [content_id],
                "practice_mode": "reading",
            },
            timeout=10,
        )
        resp.raise_for_status()
        assignment_id = resp.json()["assignment_id"]
        print(f"✅ Created assignment: {assignment_id}")
    except Exception as e:
        print(f"❌ Create assignment failed: {e}")
        return

    print()

    # Step 8: Student does speech assessment
    print("Step 8: Student performing speech assessment...")
    print(f"⏳ Waiting {RATE_LIMIT_WAIT}s for rate limit...")
    time.sleep(RATE_LIMIT_WAIT)

    student_token = login_student(student_id, student_password)
    if not student_token:
        return

    try:
        # Get student assignment
        resp = requests.get(
            f"{BASE_URL}/api/students/assignments",
            headers={"Authorization": f"Bearer {student_token}"},
            timeout=10,
        )
        resp.raise_for_status()
        assignments = resp.json()
        if not assignments:
            print("❌ No assignments found for student")
            return

        sa_id = assignments[0]["id"]
        print(f"  Student assignment: {sa_id}")

        # Get activities to find progress_id
        resp = requests.get(
            f"{BASE_URL}/api/students/assignments/{sa_id}/activities",
            headers={"Authorization": f"Bearer {student_token}"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        # The response is an object with "activities" array
        activities = data.get("activities", [])
        if not activities:
            print("❌ No activities found")
            return

        # progress_id = activity's id (StudentContentProgress.id)
        first_activity = activities[0]
        progress_id = first_activity.get("id")
        items = first_activity.get("items", [])
        reference_text = "hello"
        if items:
            reference_text = items[0].get("text", "hello")
        print(f"  Activity type: {first_activity.get('type')}")
        print(f"  Progress ID: {progress_id}")
        print(f"  Reference text: {reference_text[:50]}")

        if not progress_id or progress_id <= 0:
            print("❌ Invalid progress_id")
            return

        # Generate WAV and submit speech assessment
        print("  Generating test audio...")
        wav_bytes = generate_wav()

        print(f"  Submitting speech assessment for: {reference_text[:30]}...")
        files = {"audio_file": ("test_audio.wav", wav_bytes, "audio/wav")}
        data = {
            "reference_text": reference_text,
            "progress_id": str(progress_id),
            "assignment_id": str(sa_id),
        }

        resp = requests.post(
            f"{BASE_URL}/api/speech/assess",
            headers={"Authorization": f"Bearer {student_token}"},
            files=files,
            data=data,
            timeout=60,
        )
        print(f"  Speech assess HTTP {resp.status_code}")
        if resp.status_code != 200:
            print(f"  Response: {resp.text[:500]}")
        resp.raise_for_status()
        result = resp.json()
        print(f"✅ Speech assessment completed")
        print(f"  accuracy_score: {result.get('accuracy_score')}")
        print(f"  pronunciation_score: {result.get('pronunciation_score')}")
    except Exception as e:
        print(f"❌ Speech assessment failed: {e}")
        return

    print()

    # Step 9: Check results
    print("Step 9: Checking results...")
    print(f"⏳ Waiting {RATE_LIMIT_WAIT}s for rate limit...")
    time.sleep(RATE_LIMIT_WAIT)

    demo_token = login_teacher(DEMO_TEACHER["email"], DEMO_TEACHER["password"])
    if not demo_token:
        return

    quota_after = get_teacher_quota(demo_token)
    if quota_after is None:
        return

    print(f"⏳ Waiting {RATE_LIMIT_WAIT}s for rate limit...")
    time.sleep(RATE_LIMIT_WAIT)

    owner_token = login_teacher(ORG_OWNER["email"], ORG_OWNER["password"])
    if not owner_token:
        return

    org_points_after = get_org_points(owner_token, ORG_ID)
    if org_points_after is None:
        return

    print()

    # Step 10: Print verdict
    print("═" * 60)
    print("SCENARIO B: Personal Student → Teacher Quota")
    print("═" * 60)

    quota_deducted = quota_after["quota_used"] - quota_before["quota_used"]
    org_unchanged = org_points_after == org_points_before

    print(f"  Teacher quota BEFORE:     {quota_before['quota_used']}")
    print(f"  Teacher quota AFTER:      {quota_after['quota_used']} (expected > 0)")
    print(f"  Quota deducted:           {quota_deducted} (expected > 0)")
    print(f"  Org points BEFORE:        {org_points_before}")
    print(f"  Org points AFTER:         {org_points_after} (expected same)")
    print(
        f"  Org points unchanged:     {'YES' if org_unchanged else 'NO'} (expected YES)"
    )

    if quota_deducted > 0 and org_unchanged:
        print()
        print("  VERDICT: ✅ PASS")
    else:
        print()
        print("  VERDICT: ❌ FAIL")
        if quota_deducted <= 0:
            print("    - Teacher quota was NOT deducted")
        if not org_unchanged:
            print("    - Org points changed (should remain same)")

    print("═" * 60)


if __name__ == "__main__":
    main()
