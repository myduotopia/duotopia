"""
OAuth Identity model for SSO provider linking.
Links external OAuth provider accounts (Google, LINE, 1campus, iSchool)
to Teacher accounts.
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Text,
    ForeignKey,
    UniqueConstraint,
    Index,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class OAuthIdentity(Base):
    """OAuth 身份連結"""

    __tablename__ = "oauth_identities"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False
    )

    # OAuth provider info
    provider = Column(String(50), nullable=False)
    provider_user_id = Column(String(255), nullable=False)

    # Profile from provider
    provider_email = Column(String(255), nullable=True)
    display_name = Column(String(255), nullable=True)
    avatar_url = Column(Text, nullable=True)

    # OAuth tokens (encrypted at rest)
    access_token = Column(Text, nullable=True)
    refresh_token = Column(Text, nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)

    # Full profile for reference
    raw_profile = Column(JSONB, default=dict)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    teacher = relationship("Teacher", back_populates="oauth_identities")

    __table_args__ = (
        UniqueConstraint("provider", "provider_user_id", name="uq_oauth_provider_user"),
        UniqueConstraint("teacher_id", "provider", name="uq_oauth_teacher_provider"),
        Index("ix_oauth_identity_teacher", "teacher_id"),
        Index("ix_oauth_identity_lookup", "provider", "provider_user_id"),
    )

    def __repr__(self):
        return (
            f"<OAuthIdentity(teacher_id={self.teacher_id}, "
            f"provider='{self.provider}', "
            f"provider_user_id='{self.provider_user_id}')>"
        )
