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

# Classroom models
from .classroom import Classroom, ClassroomStudent

# Program models
from .program import Program, Lesson, Content, ContentItem, ProgramCopyLog

# Assignment models
from .assignment import Assignment, AssignmentContent, StudentAssignment

# Progress models
from .progress import (
    StudentContentProgress,
    StudentItemProgress,
    PracticeSession,
    PracticeAnswer,
)

# OAuth identity models
from .oauth_identity import OAuthIdentity

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
    # Organizations
    "Organization",
    "School",
    "TeacherOrganization",
    "TeacherSchool",
    "ClassroomSchool",
    "StudentSchool",
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
    # Progress
    "StudentContentProgress",
    "StudentItemProgress",
    "PracticeSession",
    "PracticeAnswer",
    # Points
    "OrganizationPointsLog",
    # OAuth
    "OAuthIdentity",
    # Demo
    "DemoConfig",
]
