"""
Pydantic models/schemas for teachers API validation.
"""
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import date


class TeacherProfile(BaseModel):
    id: int
    email: str
    name: str
    phone: Optional[str]
    is_demo: bool
    is_active: bool
    is_admin: bool = False

    class Config:
        from_attributes = True


class UpdateTeacherProfileRequest(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None


class UpdatePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ClassroomSummary(BaseModel):
    id: int
    name: str
    description: Optional[str]
    student_count: int
    school_id: Optional[str] = None
    school_name: Optional[str] = None
    organization_id: Optional[str] = None


class StudentSummary(BaseModel):
    id: int
    name: str
    email: Optional[str] = None  # Allow None for students without email
    classroom_name: str


class OrganizationInfo(BaseModel):
    """機構資訊"""

    id: str
    name: str
    type: str  # personal, school_group, etc.


class SchoolInfo(BaseModel):
    """學校資訊"""

    id: str
    name: str


class TeacherDashboard(BaseModel):
    teacher: TeacherProfile
    classroom_count: int
    student_count: int
    program_count: int
    classrooms: List[ClassroomSummary]
    recent_students: List[StudentSummary]
    # Subscription information
    subscription_status: str
    subscription_end_date: Optional[str]
    days_remaining: int
    can_assign_homework: bool
    can_use_ai_grading: bool = True  # 教師/機構是否有 AI 分析額度
    is_test_account: bool  # 是否為測試帳號（白名單）
    # Organization and roles information
    organization: Optional[OrganizationInfo] = None
    schools: List[SchoolInfo] = []
    roles: List[str] = []  # All unique roles from TeacherSchool and TeacherOrganization


class OrganizationRole(BaseModel):
    """機構角色"""

    organization_id: str
    organization_name: str
    role: str  # org_owner, org_admin


class SchoolRole(BaseModel):
    """學校角色"""

    school_id: str
    school_name: str
    organization_id: str
    organization_name: str
    roles: List[str]  # school_admin, teacher


class TeacherRolesResponse(BaseModel):
    """教師角色回應"""

    teacher_id: int
    organization_roles: List[OrganizationRole]
    school_roles: List[SchoolRole]
    all_roles: List[str]  # Flattened unique list of all roles


class ClassroomCreate(BaseModel):
    name: str
    description: Optional[str] = None
    level: str = "A1"


class ClassroomUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    level: Optional[str] = None


class StudentCreate(BaseModel):
    name: str
    email: Optional[str] = None  # Email（選填，可以是真實 email）
    birthdate: Optional[str] = None  # YYYY-MM-DD format（選填）
    classroom_id: Optional[int] = None  # 班級改為選填，可以之後再分配
    student_number: Optional[str] = None
    phone: Optional[str] = None  # 新增 phone 欄位


class StudentUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None  # 可更新為真實 email
    student_number: Optional[str] = None
    birthdate: Optional[str] = None
    phone: Optional[str] = None
    status: Optional[str] = None
    target_wpm: Optional[int] = None
    target_accuracy: Optional[float] = None
    classroom_id: Optional[int] = None  # 新增班級分配功能


class BatchStudentCreate(BaseModel):
    students: List[Dict[str, Any]]


class BatchImportStudent(BaseModel):
    name: str
    classroom_name: str
    birthdate: Any = None  # Can be string, int (Excel serial), etc. (optional)


class BatchImportRequest(BaseModel):
    students: List[BatchImportStudent]
    duplicate_action: Optional[str] = "skip"  # "skip", "update", or "add_suffix"


class ProgramCreate(BaseModel):
    name: str
    description: Optional[str] = None
    level: str = "A1"
    classroom_id: Optional[int] = None
    estimated_hours: Optional[int] = None
    is_template: Optional[bool] = False
    tags: Optional[List[str]] = []


class LessonCreate(BaseModel):
    name: str
    description: Optional[str] = None
    order_index: int = 0
    estimated_minutes: Optional[int] = None


class ContentCreate(BaseModel):
    type: str = "reading_assessment"
    title: str
    items: List[Dict[str, Any]]  # [{"text": "...", "translation": "..."}, ...]
    target_wpm: Optional[int] = 60
    target_accuracy: Optional[float] = 0.8
    order_index: Optional[int] = None  # None = 自動計算為最後一個位置
    level: Optional[str] = None  # None = 繼承 Program 的 level
    tags: Optional[List[str]] = []
    is_public: Optional[bool] = False


class ContentUpdate(BaseModel):
    title: Optional[str] = None
    items: Optional[List[Dict[str, Any]]] = None
    target_wpm: Optional[int] = None
    target_accuracy: Optional[float] = None
    time_limit_seconds: Optional[int] = None
    order_index: Optional[int] = None
    level: Optional[str] = None
    tags: Optional[List[str]] = None
    is_public: Optional[bool] = None


class TranslateRequest(BaseModel):
    text: str
    target_lang: str = "zh-TW"


class BatchTranslateRequest(BaseModel):
    texts: List[str]
    target_lang: str = "zh-TW"


class GenerateSentencesRequest(BaseModel):
    words: List[str]
    definitions: Optional[List[str]] = None  # 單字的中文翻譯（用於消歧義）
    lesson_id: Optional[int] = None  # 單元 ID（用於取得單元描述）
    level: Optional[str] = "A1"
    prompt: Optional[str] = None
    translate_to: Optional[str] = None  # zh-TW, ja, ko
    parts_of_speech: Optional[List[List[str]]] = None


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "en-US-JennyNeural"
    rate: Optional[str] = "+0%"
    volume: Optional[str] = "+0%"


class BatchTTSRequest(BaseModel):
    texts: List[str]
    voice: Optional[str] = "en-US-JennyNeural"
    rate: Optional[str] = "+0%"
    volume: Optional[str] = "+0%"
