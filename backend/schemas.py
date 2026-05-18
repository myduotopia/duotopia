from pydantic import BaseModel, EmailStr, Field, model_validator
from typing import Optional, List, Dict, Any, Union  # noqa: F401
from datetime import datetime  # noqa: F401
from enum import Enum
from models import ProgramLevel  # 使用 models 中定義的 Enum


# Auth schemas
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str
    user_type: str  # "teacher" or "student"
    user_id: int
    name: str


# Teacher schemas
class TeacherCreate(BaseModel):
    email: EmailStr
    password: str
    name: str


class TeacherResponse(BaseModel):
    id: int
    email: str
    name: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# Program schemas
class ProgramBase(BaseModel):
    name: str
    description: Optional[str] = None
    level: Optional[ProgramLevel] = ProgramLevel.A1
    estimated_hours: Optional[int] = None
    tags: Optional[List[str]] = None


class ProgramCreate(ProgramBase):
    pass


class ProgramUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=1000)
    level: Optional[str] = None  # 改用 str，由後端轉換為 Enum
    estimated_hours: Optional[int] = Field(None, ge=0)
    tags: Optional[List[str]] = None

    @model_validator(mode="before")
    @classmethod
    def validate_fields(cls, data):
        """Validate that name is not empty or whitespace"""
        if isinstance(data, dict):
            if "name" in data and data["name"] is not None:
                stripped = data["name"].strip()
                if not stripped:
                    raise ValueError("Name cannot be empty or whitespace")
                data["name"] = stripped
            if "description" in data and data["description"] is not None:
                data["description"] = data["description"].strip()
        return data


class ProgramResponse(ProgramBase):
    id: int
    is_template: bool
    classroom_id: Optional[int] = None
    teacher_id: int
    organization_id: Optional[str] = None
    school_id: Optional[str] = None
    source_type: Optional[str] = None
    source_metadata: Optional[Dict[str, Any]] = None
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    # Computed fields
    classroom_name: Optional[str] = None
    teacher_name: Optional[str] = None
    lesson_count: Optional[int] = 0
    is_duplicate: Optional[bool] = None
    lessons: List["LessonResponse"] = []

    @model_validator(mode="before")
    @classmethod
    def convert_uuid_fields(cls, data):
        """Convert UUID fields to strings before validation"""
        if hasattr(data, "organization_id") and data.organization_id is not None:
            if not isinstance(data.organization_id, str):
                object.__setattr__(data, "organization_id", str(data.organization_id))
        elif isinstance(data, dict) and "organization_id" in data:
            if data["organization_id"] is not None and not isinstance(
                data["organization_id"], str
            ):
                data["organization_id"] = str(data["organization_id"])

        if hasattr(data, "school_id") and data.school_id is not None:
            if not isinstance(data.school_id, str):
                object.__setattr__(data, "school_id", str(data.school_id))
        elif isinstance(data, dict) and "school_id" in data:
            if data["school_id"] is not None and not isinstance(data["school_id"], str):
                data["school_id"] = str(data["school_id"])
        return data

    class Config:
        from_attributes = True


class ProgramCopyFromTemplate(BaseModel):
    template_id: int
    classroom_id: int
    name: Optional[str] = None  # 可選，預設使用模板名稱


class ProgramCopyFromClassroom(BaseModel):
    source_program_id: int
    target_classroom_id: int
    name: Optional[str] = None  # 可選，預設使用來源名稱


class ProgramCopyRequest(BaseModel):
    target_scope: str
    target_id: Optional[Union[str, int]] = None
    name: Optional[str] = None


# Lesson schemas
class LessonBase(BaseModel):
    name: str
    description: Optional[str] = None
    order_index: int = 0
    estimated_minutes: Optional[int] = None


class LessonCreate(LessonBase):
    pass


class LessonUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=1000)
    order_index: Optional[int] = None
    estimated_minutes: Optional[int] = Field(None, ge=0)

    @model_validator(mode="before")
    @classmethod
    def validate_fields(cls, data):
        """Validate that name is not empty or whitespace"""
        if isinstance(data, dict):
            if "name" in data and data["name"] is not None:
                stripped = data["name"].strip()
                if not stripped:
                    raise ValueError("Name cannot be empty or whitespace")
                data["name"] = stripped
            if "description" in data and data["description"] is not None:
                data["description"] = data["description"].strip()
        return data


class LessonResponse(LessonBase):
    id: int
    program_id: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    contents: List["ContentResponse"] = []

    class Config:
        from_attributes = True


# Content Item schemas
class ContentItemResponse(BaseModel):
    """Response model for content item"""

    id: int
    content_id: int
    order_index: int
    text: str
    translation: Optional[str] = None
    audio_url: Optional[str] = None
    example_sentence: Optional[str] = None
    example_sentence_translation: Optional[str] = None
    example_sentence_audio_url: Optional[str] = None

    class Config:
        from_attributes = True


# Content schemas
class ContentCreate(BaseModel):
    """Request model for creating content"""

    type: str
    title: str
    order_index: int = 1


class ContentResponse(BaseModel):
    """Response model for content"""

    id: int
    # Issue #587: lesson_id may be None when content lives directly under a program
    lesson_id: Optional[int] = None
    program_id: Optional[int] = None
    type: str
    title: str
    order_index: int
    is_active: bool
    items: List["ContentItemResponse"] = []

    class Config:
        from_attributes = True


# Student schemas for teacher dashboard
class StudentCreate(BaseModel):
    name: str
    email: Optional[str] = None
    student_number: Optional[str] = None
    birthdate: str
    classroom_id: Optional[int] = None


class StudentResponse(BaseModel):
    id: int
    email: Optional[str] = None
    name: str
    classroom_id: Optional[int]
    is_active: bool
    created_at: datetime
    parent_email: Optional[str] = None
    email_verified: bool = False
    email_verified_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Email verification schemas
class EmailVerificationRequest(BaseModel):
    parent_email: EmailStr


class EmailVerificationResponse(BaseModel):
    message: str
    email: str
    verification_sent: bool


class EmailVerifyToken(BaseModel):
    token: str


class StudentEmailUpdate(BaseModel):
    parent_email: EmailStr


# Class schemas
class ClassCreate(BaseModel):
    name: str
    description: Optional[str] = None


class ClassResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    teacher_id: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# Assignment Status Enum
class AssignmentStatusEnum(str, Enum):
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    SUBMITTED = "SUBMITTED"
    GRADED = "GRADED"
    RETURNED = "RETURNED"
    RESUBMITTED = "RESUBMITTED"


# Assignment schemas
class AssignmentCreate(BaseModel):
    title: str
    description: Optional[str] = None
    classroom_id: int
    content_ids: List[int] = Field(..., min_items=1)
    student_ids: List[int] = []
    due_date: Optional[datetime] = None


class AssignmentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    content_ids: Optional[List[int]] = None
    student_ids: Optional[List[int]] = None
    due_date: Optional[datetime] = None


class AssignmentResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    classroom_id: int
    teacher_id: int
    due_date: Optional[datetime]
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class AssignmentWithDetails(AssignmentResponse):
    contents: Optional[List[Dict[str, Any]]] = []
    student_assignments: Optional[List[Dict[str, Any]]] = []


# Student Assignment schemas
class StudentAssignmentCreate(BaseModel):
    assignment_id: int
    student_id: int
    classroom_id: int
    title: str
    status: AssignmentStatusEnum = AssignmentStatusEnum.NOT_STARTED


class StudentAssignmentUpdate(BaseModel):
    status: Optional[AssignmentStatusEnum] = None
    score: Optional[float] = None
    feedback: Optional[str] = None


class StudentAssignmentResponse(BaseModel):
    id: int
    assignment_id: Optional[int]
    student_id: int
    classroom_id: int
    title: str
    status: AssignmentStatusEnum
    score: Optional[float]
    feedback: Optional[str]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class StudentAssignmentWithProgress(StudentAssignmentResponse):
    content_progress: Optional[List[Dict[str, Any]]] = []


# Student Content Progress schemas
class StudentContentProgressCreate(BaseModel):
    student_assignment_id: int
    content_id: int
    status: AssignmentStatusEnum = AssignmentStatusEnum.NOT_STARTED
    order_index: int = 0


class StudentContentProgressUpdate(BaseModel):
    status: Optional[AssignmentStatusEnum] = None
    score: Optional[float] = None
    checked: Optional[bool] = None
    feedback: Optional[str] = None
    response_data: Optional[Dict[str, Any]] = None
    ai_scores: Optional[Dict[str, Any]] = None


class StudentContentProgressResponse(BaseModel):
    id: int
    student_assignment_id: int
    content_id: int
    status: AssignmentStatusEnum
    score: Optional[float]
    checked: Optional[bool]
    feedback: Optional[str]
    response_data: Optional[Dict[str, Any]]
    ai_scores: Optional[Dict[str, Any]]
    order_index: int

    class Config:
        from_attributes = True


# Teacher Review schemas
class TeacherReviewCreate(BaseModel):
    """Schema for creating teacher review"""

    teacher_review_score: float = Field(
        ..., ge=0, le=100, description="Teacher score 0-100"
    )
    teacher_feedback: str = Field(
        ..., min_length=1, description="Teacher feedback text"
    )


class TeacherReviewUpdate(BaseModel):
    """Schema for updating teacher review"""

    teacher_review_score: Optional[float] = Field(None, ge=0, le=100)
    teacher_feedback: Optional[str] = Field(None, min_length=1)


class TeacherReviewResponse(BaseModel):
    """Response schema for teacher review"""

    student_item_progress_id: int
    teacher_review_score: Optional[float]
    teacher_feedback: Optional[str]
    teacher_reviewed_at: Optional[datetime]
    teacher_id: Optional[int]
    review_status: str

    # Include student and item info
    student_name: Optional[str]
    item_text: Optional[str]

    class Config:
        from_attributes = True


class TeacherReviewBatchCreate(BaseModel):
    """Schema for batch reviewing multiple items"""

    item_reviews: List[Dict[str, Any]] = Field(..., description="List of item reviews")


# Admin Refund schemas
class RefundRequest(BaseModel):
    """Admin 退款請求"""

    rec_trade_id: str = Field(..., description="TapPay 交易編號")
    amount: Optional[int] = Field(None, description="退款金額（None = 全額退款）")
    reason: str = Field(..., min_length=1, description="退款原因（必填）")
    notes: Optional[str] = Field(None, description="備註")


# Rebuild models to resolve forward references
ContentItemResponse.model_rebuild()
ContentResponse.model_rebuild()
LessonResponse.model_rebuild()
ProgramResponse.model_rebuild()
