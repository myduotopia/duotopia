"""40 students take a word_selection_quiz at once; 2 bystanders hit /students/me."""
import itertools
import json
import os
import random

from locust import HttpUser, between, task

TOKENS = json.load(open(os.path.join(os.path.dirname(__file__), "tokens.json")))
_seq = itertools.count()


class QuizStudent(HttpUser):
    weight = 40
    wait_time = between(1, 3)

    def on_start(self):
        me = TOKENS[next(_seq) % len(TOKENS)]
        self.sa = me["sa_id"]
        self.client.headers["Authorization"] = f"Bearer {me['token']}"
        self.queue = []
        self.session_id = None

    def _start(self):
        r = self.client.get(
            f"/api/students/assignments/{self.sa}/vocabulary/selection_quiz/start",
            name="selection_quiz/start",
        )
        if r.status_code == 200:
            body = r.json()
            self.session_id = body.get("session_id")
            self.queue = [
                (w["content_item_id"], [o["text"] for o in w["options"]])
                for w in body["words"]
            ]

    @task
    def answer(self):
        if not self.queue:
            self._start()
            return
        item_id, opts = self.queue.pop(0)
        self.client.post(
            f"/api/students/assignments/{self.sa}/vocabulary/selection_quiz/answer",
            json={
                "content_item_id": item_id,
                "selected_answer": random.choice(opts),
                "time_spent_seconds": 2,
                "session_id": self.session_id,
            },
            name="selection_quiz/answer",
        )


class Bystander(HttpUser):
    """Unrelated cheap endpoint — shows collateral slowdown."""

    weight = 2
    wait_time = between(0.5, 1)

    def on_start(self):
        self.client.headers["Authorization"] = f"Bearer {TOKENS[-1]['token']}"

    @task
    def me(self):
        self.client.get("/api/students/me", name="students/me")
