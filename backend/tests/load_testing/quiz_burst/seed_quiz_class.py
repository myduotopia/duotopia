"""Seed 1 teacher / 1 classroom / N students / 1 word_selection_quiz (10 items).

Run from backend/ with DATABASE_URL pointing at the local loadtest Postgres.
Writes tokens.json (student JWTs + SA ids) next to this file.

``--tokens-only``：不重新 seed，只替已存在的學生重簽 token（bench.sh 每次都會跑，
避免 token 過期造成整輪 401）。
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.getcwd())

from auth import create_access_token, get_password_hash  # noqa: E402
from database import SessionLocal  # noqa: E402
from models import (  # noqa: E402
    Assignment,
    AssignmentContent,
    AssignmentStatus,
    Classroom,
    ClassroomStudent,
    Content,
    ContentItem,
    ContentType,
    Lesson,
    Program,
    Student,
    StudentAssignment,
    Teacher,
)

N = int(os.getenv("N_STUDENTS", "40"))
WORDS = [
    ("apple", "蘋果"),
    ("banana", "香蕉"),
    ("teacher", "老師"),
    ("library", "圖書館"),
    ("happy", "快樂的"),
    ("river", "河流"),
    ("window", "窗戶"),
    ("yellow", "黃色"),
    ("doctor", "醫生"),
    ("winter", "冬天"),
]

TOKENS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tokens.json")


def write_tokens(db):
    rows = (
        db.query(StudentAssignment.id, StudentAssignment.student_id)
        .filter(StudentAssignment.title == "lt-quiz")
        .order_by(StudentAssignment.id)
        .all()
    )
    if not rows:
        sys.exit("no seeded students found; run without --tokens-only first")
    out = [
        {
            "sa_id": sa_id,
            "token": create_access_token(
                {"sub": str(student_id), "type": "student"},
                expires_delta=timedelta(days=1),
            ),
        }
        for sa_id, student_id in rows
    ]
    with open(TOKENS_PATH, "w") as f:
        json.dump(out, f)
    return len(out)


db = SessionLocal()
if "--tokens-only" in sys.argv:
    print(f"refreshed {write_tokens(db)} tokens")
    sys.exit(0)
if db.query(Teacher).filter(Teacher.email == "lt-teacher@test.com").first():
    sys.exit("already seeded; drop the DB first")
pw = get_password_hash("password123")
t = Teacher(
    name="lt",
    email="lt-teacher@test.com",
    password_hash=pw,
    email_verified=True,
    is_active=True,
)
db.add(t)
db.flush()
c = Classroom(name="lt-class", teacher_id=t.id, is_active=True)
db.add(c)
db.flush()
p = Program(name="lt-p", teacher_id=t.id, level="A1", is_template=False, is_active=True)
db.add(p)
db.flush()
le = Lesson(name="lt-l", program_id=p.id, order_index=1, is_active=True)
db.add(le)
db.flush()
ct = Content(
    lesson_id=le.id,
    title="lt-ct",
    type=ContentType.EXAMPLE_SENTENCES,
    order_index=1,
    is_active=True,
    is_assignment_copy=True,
)
db.add(ct)
db.flush()
items = []
for i, (w, tr) in enumerate(WORDS):
    it = ContentItem(
        content_id=ct.id,
        order_index=i + 1,
        text=w,
        translation=tr,
        example_sentence=f"I see the {w} today.",
    )
    db.add(it)
    items.append(it)
db.flush()
a = Assignment(
    title="lt-quiz",
    classroom_id=c.id,
    teacher_id=t.id,
    practice_mode="word_selection_quiz",
    show_image=False,
    shuffle_questions=True,
    is_active=True,
)
db.add(a)
db.flush()
db.add(AssignmentContent(assignment_id=a.id, content_id=ct.id, order_index=1))

for n in range(N):
    s = Student(
        name=f"s{n}",
        email=f"lt-s{n}@test.com",
        password_hash=pw,
        email_verified=True,
        is_active=True,
        birthdate=datetime(2012, 1, 1).date(),
    )
    db.add(s)
    db.flush()
    db.add(ClassroomStudent(classroom_id=c.id, student_id=s.id, is_active=True))
    sa = StudentAssignment(
        assignment_id=a.id,
        student_id=s.id,
        teacher_id=t.id,
        classroom_id=c.id,
        title="lt-quiz",
        status=AssignmentStatus.NOT_STARTED,
        is_active=True,
        assigned_at=datetime.now(timezone.utc),
    )
    db.add(sa)
db.commit()
write_tokens(db)
print(f"seeded {N} students, assignment {a.id}, items {[it.id for it in items]}")
