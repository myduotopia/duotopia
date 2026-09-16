"""班級學生分組 API 測試 — Issue #1046。

覆蓋幾件光看 model 看不出來、壞掉又最有感的事：
- 別人的班級一律 404（不是 403，也不能因為 group_id 猜中就讀得到）
- 組長必須是成員之一、成員必須是本班學生
- 成員順序即 sort_order，拖曳排序送什麼順序就存什麼順序
- 一個學生可以同時屬於多組（這是 issue 明訂需求，不能被唯一約束擋掉）
"""

import pytest

from auth import create_access_token, get_password_hash
from models import (
    Classroom,
    ClassroomStudent,
    Student,
    StudentGroup,
    StudentGroupMember,
    Teacher,
)


@pytest.fixture
def teacher_a(shared_test_session):
    t = Teacher(
        email="groups_a@duotopia.com",
        password_hash=get_password_hash("test123"),
        name="Teacher A",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def teacher_b(shared_test_session):
    t = Teacher(
        email="groups_b@duotopia.com",
        password_hash=get_password_hash("test123"),
        name="Teacher B",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


def _headers(teacher):
    token = create_access_token(data={"sub": str(teacher.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def classroom_a(shared_test_session, teacher_a):
    c = Classroom(name="Group Class A", teacher_id=teacher_a.id, is_active=True)
    shared_test_session.add(c)
    shared_test_session.commit()
    shared_test_session.refresh(c)
    return c


@pytest.fixture
def students_a(shared_test_session, classroom_a):
    """班上三位學生，座號 01 / 02 / 03。"""
    made = []
    for number, name in [("01", "Amy"), ("02", "Ben"), ("03", "Cara")]:
        s = Student(name=name, student_number=number, is_active=True)
        shared_test_session.add(s)
        shared_test_session.flush()
        shared_test_session.add(
            ClassroomStudent(
                classroom_id=classroom_a.id, student_id=s.id, is_active=True
            )
        )
        made.append(s)
    shared_test_session.commit()
    for s in made:
        shared_test_session.refresh(s)
    return made


@pytest.fixture
def outsider_student(shared_test_session):
    """不屬於 classroom_a 的學生。"""
    s = Student(name="Outsider", student_number="99", is_active=True)
    shared_test_session.add(s)
    shared_test_session.commit()
    shared_test_session.refresh(s)
    return s


# ============ 權限 ============


def test_list_groups_of_another_teachers_classroom_is_404(
    test_client, classroom_a, teacher_b
):
    resp = test_client.get(
        f"/api/teachers/classrooms/{classroom_a.id}/groups",
        headers=_headers(teacher_b),
    )
    assert resp.status_code == 404


def test_update_group_of_another_teachers_classroom_is_404(
    test_client, shared_test_session, classroom_a, teacher_b
):
    """知道 group_id 也不該讀得到 —— 權限是靠班級歸屬，不是靠 id 難猜。"""
    group = StudentGroup(classroom_id=classroom_a.id, name="第一組", sort_order=0)
    shared_test_session.add(group)
    shared_test_session.commit()
    shared_test_session.refresh(group)

    resp = test_client.put(
        f"/api/teachers/groups/{group.id}",
        headers=_headers(teacher_b),
        json={"name": "被改掉", "member_student_ids": []},
    )
    assert resp.status_code == 404


# ============ 建立與驗證 ============


def test_create_group_with_ordered_members(
    test_client, classroom_a, teacher_a, students_a
):
    amy, ben, cara = students_a
    # 刻意用非遞增的 id 順序送，確認回傳照送出的順序而不是 id 順序
    resp = test_client.post(
        f"/api/teachers/classrooms/{classroom_a.id}/groups",
        headers=_headers(teacher_a),
        json={
            "name": "第一組",
            "color": "amber",
            "member_student_ids": [cara.id, amy.id, ben.id],
            "leader_student_id": amy.id,
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "第一組"
    assert body["color"] == "amber"
    assert body["leader_student_id"] == amy.id
    assert [m["student_id"] for m in body["members"]] == [cara.id, amy.id, ben.id]
    assert [m["sort_order"] for m in body["members"]] == [0, 1, 2]
    assert [m["student_number"] for m in body["members"]] == ["03", "01", "02"]


def test_leader_must_be_a_member(test_client, classroom_a, teacher_a, students_a):
    amy, ben, _ = students_a
    resp = test_client.post(
        f"/api/teachers/classrooms/{classroom_a.id}/groups",
        headers=_headers(teacher_a),
        json={
            "name": "第一組",
            "member_student_ids": [amy.id],
            "leader_student_id": ben.id,  # 不在成員名單裡
        },
    )
    assert resp.status_code == 422


def test_member_must_belong_to_the_classroom(
    test_client, classroom_a, teacher_a, students_a, outsider_student
):
    amy, _, _ = students_a
    resp = test_client.post(
        f"/api/teachers/classrooms/{classroom_a.id}/groups",
        headers=_headers(teacher_a),
        json={
            "name": "第一組",
            "member_student_ids": [amy.id, outsider_student.id],
        },
    )
    assert resp.status_code == 422


def test_unknown_color_is_rejected(test_client, classroom_a, teacher_a):
    resp = test_client.post(
        f"/api/teachers/classrooms/{classroom_a.id}/groups",
        headers=_headers(teacher_a),
        json={"name": "第一組", "color": "#ff00ff", "member_student_ids": []},
    )
    assert resp.status_code == 422


def test_duplicate_name_in_same_classroom_is_409(test_client, classroom_a, teacher_a):
    payload = {"name": "第一組", "member_student_ids": []}
    first = test_client.post(
        f"/api/teachers/classrooms/{classroom_a.id}/groups",
        headers=_headers(teacher_a),
        json=payload,
    )
    assert first.status_code == 201

    second = test_client.post(
        f"/api/teachers/classrooms/{classroom_a.id}/groups",
        headers=_headers(teacher_a),
        json=payload,
    )
    assert second.status_code == 409


def test_student_can_belong_to_multiple_groups(
    test_client, classroom_a, teacher_a, students_a
):
    """issue #1046 明訂一個學生可屬多組，不能被唯一約束擋掉。"""
    amy, ben, _ = students_a
    for name in ("英文組", "打掃組"):
        resp = test_client.post(
            f"/api/teachers/classrooms/{classroom_a.id}/groups",
            headers=_headers(teacher_a),
            json={"name": name, "member_student_ids": [amy.id, ben.id]},
        )
        assert resp.status_code == 201

    listing = test_client.get(
        f"/api/teachers/classrooms/{classroom_a.id}/groups",
        headers=_headers(teacher_a),
    ).json()
    assert len(listing) == 2
    for group in listing:
        assert amy.id in [m["student_id"] for m in group["members"]]


# ============ 更新 ============


def test_update_replaces_members_wholesale(
    test_client, classroom_a, teacher_a, students_a
):
    amy, ben, cara = students_a
    created = test_client.post(
        f"/api/teachers/classrooms/{classroom_a.id}/groups",
        headers=_headers(teacher_a),
        json={"name": "第一組", "member_student_ids": [amy.id, ben.id]},
    ).json()

    updated = test_client.put(
        f"/api/teachers/groups/{created['id']}",
        headers=_headers(teacher_a),
        json={
            "name": "第一組",
            "color": "sky",
            "member_student_ids": [cara.id],
            "leader_student_id": cara.id,
        },
    )
    assert updated.status_code == 200
    body = updated.json()
    assert [m["student_id"] for m in body["members"]] == [cara.id]
    assert body["leader_student_id"] == cara.id
    assert body["color"] == "sky"


def test_renaming_a_group_to_its_own_name_is_allowed(
    test_client, classroom_a, teacher_a
):
    """改顏色但不改名不該撞到自己的唯一約束。"""
    created = test_client.post(
        f"/api/teachers/classrooms/{classroom_a.id}/groups",
        headers=_headers(teacher_a),
        json={"name": "第一組", "member_student_ids": []},
    ).json()

    resp = test_client.put(
        f"/api/teachers/groups/{created['id']}",
        headers=_headers(teacher_a),
        json={"name": "第一組", "color": "rose", "member_student_ids": []},
    )
    assert resp.status_code == 200
    assert resp.json()["color"] == "rose"


# ============ 排序 ============


def test_reorder_groups(test_client, classroom_a, teacher_a):
    ids = []
    for name in ("第一組", "第二組", "第三組"):
        ids.append(
            test_client.post(
                f"/api/teachers/classrooms/{classroom_a.id}/groups",
                headers=_headers(teacher_a),
                json={"name": name, "member_student_ids": []},
            ).json()["id"]
        )

    reversed_ids = list(reversed(ids))
    resp = test_client.put(
        f"/api/teachers/classrooms/{classroom_a.id}/groups/order",
        headers=_headers(teacher_a),
        json={"group_ids": reversed_ids},
    )
    assert resp.status_code == 200
    assert [g["id"] for g in resp.json()] == reversed_ids

    # 重新讀一次確認真的存進去，不是只有回應排對
    listing = test_client.get(
        f"/api/teachers/classrooms/{classroom_a.id}/groups",
        headers=_headers(teacher_a),
    ).json()
    assert [g["id"] for g in listing] == reversed_ids


def test_partial_reorder_is_rejected(test_client, classroom_a, teacher_a):
    """只送一部分 id，沒被提到的組別會留著舊 sort_order，排序沒有定義。"""
    ids = []
    for name in ("第一組", "第二組"):
        ids.append(
            test_client.post(
                f"/api/teachers/classrooms/{classroom_a.id}/groups",
                headers=_headers(teacher_a),
                json={"name": name, "member_student_ids": []},
            ).json()["id"]
        )

    resp = test_client.put(
        f"/api/teachers/classrooms/{classroom_a.id}/groups/order",
        headers=_headers(teacher_a),
        json={"group_ids": [ids[0]]},
    )
    assert resp.status_code == 422


# ============ 刪除 ============


def test_delete_group_removes_its_members(
    test_client, shared_test_session, classroom_a, teacher_a, students_a
):
    amy, ben, _ = students_a
    created = test_client.post(
        f"/api/teachers/classrooms/{classroom_a.id}/groups",
        headers=_headers(teacher_a),
        json={"name": "第一組", "member_student_ids": [amy.id, ben.id]},
    ).json()

    resp = test_client.delete(
        f"/api/teachers/groups/{created['id']}", headers=_headers(teacher_a)
    )
    assert resp.status_code == 204

    remaining = (
        shared_test_session.query(StudentGroupMember)
        .filter(StudentGroupMember.group_id == created["id"])
        .count()
    )
    assert remaining == 0
    # 學生本人當然不能跟著被刪掉
    assert shared_test_session.query(Student).filter(Student.id == amy.id).first()
