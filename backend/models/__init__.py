"""
Database models package.
All models are re-exported here for backward compatibility.
"""

# Base types and enums
from .base import (
    Base,
    UUID,
    JSONType,
    UserRole,
    ProgramLevel,
    AssignmentStatus,
    AnswerMode,
    TransactionType,
    TransactionStatus,
    ContentType,
    PracticeMode,
    ScoreCategory,
    ProgramVisibility,
)

# User models
from .user import Teacher, Student, Identity

# Subscription models
from .subscription import (
    SubscriptionPeriod,
    PointUsageLog,
    TeacherSubscriptionTransaction,
    InvoiceStatusHistory,
)

# Credit package models
from .credit_package import CreditPackage
from .credit_package_definition import CreditPackageDefinition

# Magic Paste 每月配額計數（issue #891）
from .magic_paste_usage import MagicPasteUsage

# Plan models (admin-editable price/quota overrides)
from .plan import Plan

# Promo code / referral models (issue #637)
from .promo_code import (
    PromoCode,
    PromoReferral,
    PromoRewardConfig,
    PromoRewardEvent,
)

# Organization models
from .organization import (
    Organization,
    OrganizationPointsLog,
    School,
    TeacherOrganization,
    TeacherSchool,
    ClassroomSchool,
    StudentSchool,
)

# Student status history (issue #768 — per-head billing trail)
from .student_status_history import StudentStatusHistory

# Institution billing invoices (issue #838 — 請款 / 應收帳款 data layer)
from .institution_invoice import (
    InstitutionInvoice,
    InstitutionInvoiceEmail,
    INVOICE_STATUSES,
)

# Classroom models
from .classroom import Classroom, ClassroomStudent

# Program models
from .program import Program, Lesson, Content, ContentItem, ProgramCopyLog

# Assignment models
from .assignment import (
    Assignment,
    AssignmentContent,
    StudentAssignment,
    AssignmentAnalysisReport,
)

# Progress models
from .progress import (
    StudentContentProgress,
    StudentItemProgress,
    PracticeSession,
    PracticeAnswer,
)

# OAuth identity models
from .oauth_identity import OAuthIdentity

# Blog models
from .blog import BlogPost, BlogCategory, BlogPostCategory

# Demo models
from .demo_config import DemoConfig

__all__ = [
    # Base
    "Base",
    "UUID",
    "JSONType",
    # Enums
    "UserRole",
    "ProgramLevel",
    "AssignmentStatus",
    "AnswerMode",
    "TransactionType",
    "TransactionStatus",
    "ContentType",
    "PracticeMode",
    "ScoreCategory",
    "ProgramVisibility",
    # Users
    "Teacher",
    "Student",
    "Identity",
    # Subscriptions
    "SubscriptionPeriod",
    "PointUsageLog",
    "TeacherSubscriptionTransaction",
    "InvoiceStatusHistory",
    # Credit packages
    "CreditPackage",
    "CreditPackageDefinition",
    "MagicPasteUsage",
    # Plans
    "Plan",
    # Promo codes / referrals
    "PromoCode",
    "PromoReferral",
    "PromoRewardConfig",
    "PromoRewardEvent",
    # Organizations
    "Organization",
    "School",
    "TeacherOrganization",
    "TeacherSchool",
    "ClassroomSchool",
    "StudentSchool",
    # Student status history
    "StudentStatusHistory",
    # Institution billing invoices
    "InstitutionInvoice",
    "InstitutionInvoiceEmail",
    "INVOICE_STATUSES",
    # Classrooms
    "Classroom",
    "ClassroomStudent",
    # Programs
    "Program",
    "Lesson",
    "Content",
    "ContentItem",
    "ProgramCopyLog",
    # Assignments
    "Assignment",
    "AssignmentContent",
    "StudentAssignment",
    "AssignmentAnalysisReport",
    # Progress
    "StudentContentProgress",
    "StudentItemProgress",
    "PracticeSession",
    "PracticeAnswer",
    # Points
    "OrganizationPointsLog",
    # OAuth
    "OAuthIdentity",
    # Blog
    "BlogPost",
    "BlogCategory",
    "BlogPostCategory",
    # Demo
    "DemoConfig",
]
