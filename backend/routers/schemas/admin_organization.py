"""Admin-only organization creation schemas"""

from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List
from datetime import datetime


class AdminOrganizationCreate(BaseModel):
    """Request to create organization with owner assignment (admin only)"""

    # Organization info
    name: str = Field(..., min_length=1, max_length=100, description="機構英文名稱")
    display_name: Optional[str] = Field(None, max_length=200, description="機構顯示名稱（中文）")
    description: Optional[str] = Field(None, description="機構描述")
    tax_id: Optional[str] = Field(None, max_length=20, description="統一編號")
    teacher_limit: Optional[int] = Field(None, ge=1, description="教師授權總數")

    # Contact info (optional)
    contact_email: Optional[EmailStr] = Field(None, max_length=200)
    contact_phone: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = None

    # Owner assignment
    owner_email: EmailStr = Field(..., description="機構擁有人 Email（必須已註冊）")

    # Project staff assignment
    project_staff_emails: Optional[List[EmailStr]] = Field(
        default=None, description="專案服務人員 Email 列表（org_admin 角色）"
    )

    # Points allocation
    total_points: int = Field(default=0, ge=0, description="組織總點數配額")

    # Subscription dates
    subscription_start_date: Optional[datetime] = Field(None, description="訂閱開始時間")
    subscription_end_date: Optional[datetime] = Field(None, description="訂閱結束時間")

    class Config:
        json_schema_extra = {
            "example": {
                "name": "ABC Education",
                "display_name": "ABC 教育集團",
                "description": "Professional English education organization",
                "tax_id": "12345678",
                "teacher_limit": 10,
                "contact_email": "contact@abc.edu.tw",
                "contact_phone": "02-1234-5678",
                "address": "台北市信義區信義路五段7號",
                "owner_email": "wang@abc.edu.tw",
                "project_staff_emails": ["staff@duotopia.com"],
                "total_points": 10000,
                "subscription_start_date": "2026-01-01T00:00:00Z",
                "subscription_end_date": "2026-12-31T23:59:59Z",
            }
        }


class AdminOrganizationResponse(BaseModel):
    """Response after creating organization"""

    organization_id: str
    organization_name: str
    owner_email: str
    owner_id: int
    project_staff_assigned: Optional[List[str]] = Field(
        default=None, description="Project staff emails assigned as org_admin"
    )
    message: str

    class Config:
        json_schema_extra = {
            "example": {
                "organization_id": "550e8400-e29b-41d4-a716-446655440000",
                "organization_name": "ABC Education",
                "owner_email": "wang@abc.edu.tw",
                "owner_id": 42,
                "project_staff_assigned": ["staff@duotopia.com"],
                "message": (
                    "Organization created successfully. "
                    "Owner wang@abc.edu.tw has been assigned org_owner role. "
                    "1 project staff assigned."
                ),
            }
        }


class OrganizationStatisticsResponse(BaseModel):
    """Organization teacher statistics"""

    teacher_count: int = Field(..., description="Active teachers in organization")
    teacher_limit: Optional[int] = Field(
        None, description="Maximum teachers allowed (None = unlimited)"
    )
    usage_percentage: float = Field(..., description="Percentage of limit used (0-100)")

    class Config:
        json_schema_extra = {
            "example": {
                "teacher_count": 5,
                "teacher_limit": 10,
                "usage_percentage": 50.0,
            }
        }


class TeacherLookupResponse(BaseModel):
    """Teacher lookup response for organization owner assignment"""

    id: int
    email: EmailStr
    name: str
    phone: Optional[str] = None
    email_verified: bool

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 42,
                "email": "teacher@example.com",
                "name": "John Doe",
                "phone": "0912345678",
                "email_verified": True,
            }
        }


class OrganizationListItem(BaseModel):
    """Organization list item for admin table"""

    id: str
    name: str
    display_name: Optional[str] = None
    description: Optional[str] = None
    tax_id: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    owner_email: str
    owner_name: Optional[str] = None
    teacher_count: int
    teacher_limit: Optional[int] = None
    total_points: int
    used_points: int
    remaining_points: int
    is_active: bool
    created_at: str
    subscription_start_date: Optional[str] = None
    subscription_end_date: Optional[str] = None
    # Phase 5-2 (issue #768): expose institution monthly price + org_type so
    # the admin edit dialog can prefill values and the UI can show org-type
    # context (institution vs group_buy).
    org_type: Optional[str] = None
    per_student_price: Optional[int] = None


class OrganizationListResponse(BaseModel):
    """Paginated organization list"""

    items: list[OrganizationListItem]
    total: int
    limit: int
    offset: int


class AdminOrganizationUpdate(BaseModel):
    """Update organization request (admin only)"""

    display_name: Optional[str] = None
    description: Optional[str] = None
    tax_id: Optional[str] = None
    teacher_limit: Optional[int] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    total_points: Optional[int] = None  # Can adjust points allocation
    subscription_start_date: Optional[datetime] = None
    subscription_end_date: Optional[datetime] = None
    # Phase 5-2 (issue #768): institution monthly per-student price (NT$)
    per_student_price: Optional[int] = Field(None, gt=0)


class AdminOrganizationUpdateResponse(BaseModel):
    """Update organization response"""

    organization_id: str
    message: str
    points_adjusted: bool = False
    points_change: Optional[int] = None
