"""Schemas package for routers"""

from .classroom import (
    SchoolClassroomCreate,
    SchoolClassroomUpdate,
    AssignTeacherRequest,
    ClassroomGradeItem,
    BatchClassroomGradeRequest,
)

__all__ = [
    "SchoolClassroomCreate",
    "SchoolClassroomUpdate",
    "AssignTeacherRequest",
    "ClassroomGradeItem",
    "BatchClassroomGradeRequest",
]
