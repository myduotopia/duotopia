"""Classroom request/response schemas for school management"""

from pydantic import BaseModel, Field, field_validator, model_validator
from typing import List, Optional
from datetime import datetime

from models.base import ProgramLevel
from models.question_bank import GRADE_MAX, GRADE_MIN

# 批次設定年級一次最多幾個班級（#1097）
BATCH_GRADE_MAX_ITEMS = 200


class SchoolClassroomCreate(BaseModel):
    """Request to create classroom in school"""

    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    level: str = Field(default="A1", pattern="^(PREA|A1|A2|B1|B2|C1|C2)$")
    grade: int = Field(..., ge=GRADE_MIN, le=GRADE_MAX)  # 年級 1–12（必填）
    teacher_id: Optional[int] = None  # Optional: Can assign later

    class Config:
        json_schema_extra = {
            "example": {
                "name": "一年級 A 班",
                "description": "一年級英文基礎班",
                "level": "A1",
                "grade": 1,
                "teacher_id": 123,
            }
        }


class SchoolClassroomUpdate(BaseModel):
    """Request to update classroom"""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    level: Optional[str] = Field(None, pattern="^(PREA|A1|A2|B1|B2|C1|C2)$")
    grade: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    is_active: Optional[bool] = None

    class Config:
        json_schema_extra = {"example": {"name": "一年級 A 班（進階）", "level": "A2"}}


class AssignTeacherRequest(BaseModel):
    """Request to assign/reassign teacher to classroom"""

    teacher_id: Optional[int] = None  # None = unassign

    class Config:
        json_schema_extra = {"example": {"teacher_id": 123}}


class ClassroomGradeItem(BaseModel):
    """單一班級的年級設定"""

    classroom_id: int
    grade: int = Field(..., ge=GRADE_MIN, le=GRADE_MAX)


class BatchClassroomGradeRequest(BaseModel):
    """批次設定班級年級（個人老師與機構後台共用，#1097）

    同時服務「補填年級」與「升／降一級」：升降計算在前端，
    後端只驗證範圍與權限後整批寫入（全有或全無）。
    """

    items: List[ClassroomGradeItem] = Field(
        ..., min_length=1, max_length=BATCH_GRADE_MAX_ITEMS
    )

    @field_validator("items")
    @classmethod
    def no_duplicate_classrooms(
        cls, v: List[ClassroomGradeItem]
    ) -> List[ClassroomGradeItem]:
        ids = [item.classroom_id for item in v]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate classroom_id in items")
        return v

    class Config:
        json_schema_extra = {
            "example": {
                "items": [
                    {"classroom_id": 1, "grade": 4},
                    {"classroom_id": 2, "grade": 5},
                ]
            }
        }


def normalize_program_level(raw: str) -> str:
    """等級字串 → ProgramLevel 的 value（"preA"／"A1"…"C2"）。

    接受 "preA"、"PREA"、"PRE_A"、"pre-a" 與大小寫不拘的 A1–C2；
    其他值 raise ValueError（Pydantic 轉為 422）。
    """
    key = str(raw).strip().upper().replace("-", "").replace("_", "")
    for level in ProgramLevel:
        if key == level.value.upper():
            return level.value
    raise ValueError("Invalid level; expected one of preA, A1, A2, B1, B2, C1, C2")


class ClassroomBatchUpdateItem(BaseModel):
    """單一班級的批次更新內容（年級／等級／啟用狀態，至少一項）"""

    classroom_id: int
    grade: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    level: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("level")
    @classmethod
    def validate_level(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return normalize_program_level(v)

    @model_validator(mode="after")
    def at_least_one_field(self) -> "ClassroomBatchUpdateItem":
        if self.grade is None and self.level is None and self.is_active is None:
            raise ValueError("Each item needs at least one of grade, level, is_active")
        return self


class BatchClassroomUpdateRequest(BaseModel):
    """批次更新個人班級的年級／等級／啟用狀態（#1097）

    全有或全無；停用（未刪除）的班級也可更新，才能重新啟用。
    """

    items: List[ClassroomBatchUpdateItem] = Field(
        ..., min_length=1, max_length=BATCH_GRADE_MAX_ITEMS
    )

    @field_validator("items")
    @classmethod
    def no_duplicate_classrooms(
        cls, v: List[ClassroomBatchUpdateItem]
    ) -> List[ClassroomBatchUpdateItem]:
        ids = [item.classroom_id for item in v]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate classroom_id in items")
        return v

    class Config:
        json_schema_extra = {
            "example": {
                "items": [
                    {"classroom_id": 1, "level": "B1"},
                    {"classroom_id": 2, "is_active": False},
                ]
            }
        }
