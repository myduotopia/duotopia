"""Student request/response schemas for school management"""

from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from datetime import date, datetime


class SchoolStudentCreate(BaseModel):
    """Request to create student in school"""

    name: str = Field(..., min_length=1, max_length=100)
    email: Optional[str] = Field(None, max_length=255)
    student_number: Optional[str] = Field(None, max_length=50)
    birthdate: Optional[str] = Field(
        None, pattern=r"^\d{4}-\d{2}-\d{2}$"
    )  # YYYY-MM-DD（選填）
    phone: Optional[str] = Field(None, max_length=20)

    @field_validator("birthdate", mode="before")
    @classmethod
    def empty_birthdate_to_none(cls, v: Optional[str]) -> Optional[str]:
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("student_number")
    @classmethod
    def validate_student_number(cls, v: Optional[str]) -> Optional[str]:
        """Validate student_number format"""
        if v is None:
            return v
        v = v.strip()
        if not v:
            return None
        if len(v) > 50:
            raise ValueError("學號長度不能超過 50 個字符")
        import re

        if not re.match(r"^[a-zA-Z0-9_-]+$", v):
            raise ValueError("學號只能包含字母、數字、連字號和底線")
        return v

    @field_validator("email", "phone")
    @classmethod
    def normalize_empty_strings(cls, v: Optional[str]) -> Optional[str]:
        """Convert empty strings to None"""
        if v is None:
            return v
        v = v.strip()
        return None if not v else v

    class Config:
        json_schema_extra = {
            "example": {
                "name": "張三",
                "email": "zhang@example.com",
                "student_number": "001",
                "birthdate": "2010-01-01",
                "phone": "0912345678",
            }
        }


class SchoolStudentUpdate(BaseModel):
    """Request to update student"""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    email: Optional[str] = Field(None, max_length=255)
    student_number: Optional[str] = Field(None, max_length=50)
    birthdate: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    phone: Optional[str] = Field(None, max_length=20)
    is_active: Optional[bool] = None

    @field_validator("birthdate", mode="before")
    @classmethod
    def empty_birthdate_to_none(cls, v: Optional[str]) -> Optional[str]:
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("student_number")
    @classmethod
    def validate_student_number(cls, v: Optional[str]) -> Optional[str]:
        """Validate student_number format"""
        if v is None:
            return v
        v = v.strip()
        if not v:
            return None
        if len(v) > 50:
            raise ValueError("學號長度不能超過 50 個字符")
        import re

        if not re.match(r"^[a-zA-Z0-9_-]+$", v):
            raise ValueError("學號只能包含字母、數字、連字號和底線")
        return v

    @field_validator("email", "phone")
    @classmethod
    def normalize_empty_strings(cls, v: Optional[str]) -> Optional[str]:
        """Convert empty strings to None"""
        if v is None:
            return v
        v = v.strip()
        return None if not v else v

    class Config:
        json_schema_extra = {
            "example": {"name": "張三（更新）", "email": "zhang_new@example.com"}
        }


class SchoolInfo(BaseModel):
    """School information"""

    id: str
    name: str

    class Config:
        from_attributes = True


class ClassroomInfo(BaseModel):
    """Classroom information"""

    id: int
    name: str
    school_id: str

    class Config:
        from_attributes = True


class SchoolStudentResponse(BaseModel):
    """Response for school student"""

    id: int
    name: str
    email: Optional[str]
    student_number: Optional[str]
    birthdate: Optional[str]
    is_active: bool
    last_login: Optional[datetime]
    schools: List[SchoolInfo]
    classrooms: List[ClassroomInfo]

    class Config:
        from_attributes = True


class AssignClassroomRequest(BaseModel):
    """Request to assign student to classroom"""

    classroom_id: int

    class Config:
        json_schema_extra = {"example": {"classroom_id": 5}}


class BatchAssignRequest(BaseModel):
    """Request to batch assign students to classroom"""

    student_ids: List[int] = Field(..., min_items=1)

    class Config:
        json_schema_extra = {"example": {"student_ids": [1, 2, 3]}}


class BatchStudentImportItem(BaseModel):
    """Single student import item"""

    name: str = Field(..., min_length=1, max_length=100)
    email: Optional[str] = Field(None, max_length=255)
    student_number: Optional[str] = Field(None, max_length=50)
    birthdate: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    phone: Optional[str] = Field(None, max_length=20)
    classroom_id: Optional[int] = None

    @field_validator("birthdate", mode="before")
    @classmethod
    def empty_birthdate_to_none(cls, v: Optional[str]) -> Optional[str]:
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("student_number")
    @classmethod
    def validate_student_number(cls, v: Optional[str]) -> Optional[str]:
        """Validate student_number format"""
        if v is None:
            return v
        v = v.strip()
        if not v:
            return None
        if len(v) > 50:
            raise ValueError("學號長度不能超過 50 個字符")
        import re

        if not re.match(r"^[a-zA-Z0-9_-]+$", v):
            raise ValueError("學號只能包含字母、數字、連字號和底線")
        return v

    @field_validator("email", "phone")
    @classmethod
    def normalize_empty_strings(cls, v: Optional[str]) -> Optional[str]:
        """Convert empty strings to None"""
        if v is None:
            return v
        v = v.strip()
        return None if not v else v


class BatchStudentImport(BaseModel):
    """Request to batch import students"""

    students: List[BatchStudentImportItem] = Field(..., min_items=1)
    duplicate_action: str = Field(default="skip", pattern="^(skip|update|add_suffix)$")

    class Config:
        json_schema_extra = {
            "example": {
                "students": [
                    {
                        "name": "張三",
                        "email": "zhang@example.com",
                        "student_number": "001",
                        "birthdate": "2010-01-01",
                        "classroom_id": 5,
                    }
                ],
                "duplicate_action": "skip",
            }
        }
