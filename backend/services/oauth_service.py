"""
OAuth Service for managing external identity provider linking.
Supports: Google, LINE, 1campus, iSchool (and future providers).
"""

from typing import Optional

from sqlalchemy.orm import Session

from models.oauth_identity import OAuthIdentity


class OAuthService:
    """Service for OAuth identity CRUD operations."""

    @staticmethod
    def find_by_provider(
        db: Session, provider: str, provider_user_id: str
    ) -> Optional[OAuthIdentity]:
        """Find an OAuth identity by provider and provider user ID.

        Used during OAuth callback to check if a returning user
        already has a linked account.
        """
        return (
            db.query(OAuthIdentity)
            .filter(
                OAuthIdentity.provider == provider,
                OAuthIdentity.provider_user_id == provider_user_id,
            )
            .first()
        )

    @staticmethod
    def find_by_provider_email(
        db: Session, provider: str, email: str
    ) -> Optional[OAuthIdentity]:
        """Find an OAuth identity by provider and email.

        Used for account auto-linking when provider email matches
        an existing teacher email.
        """
        return (
            db.query(OAuthIdentity)
            .filter(
                OAuthIdentity.provider == provider,
                OAuthIdentity.provider_email == email,
            )
            .first()
        )

    @staticmethod
    def link_account(
        db: Session,
        teacher_id: int,
        provider: str,
        provider_user_id: str,
        provider_email: Optional[str] = None,
        display_name: Optional[str] = None,
        avatar_url: Optional[str] = None,
        access_token: Optional[str] = None,
        refresh_token: Optional[str] = None,
        token_expires_at=None,
        raw_profile: Optional[dict] = None,
    ) -> OAuthIdentity:
        """Link an OAuth provider account to a teacher.

        Creates a new OAuthIdentity record linking the external
        provider account to the specified teacher.
        """
        identity = OAuthIdentity(
            teacher_id=teacher_id,
            provider=provider,
            provider_user_id=provider_user_id,
            provider_email=provider_email,
            display_name=display_name,
            avatar_url=avatar_url,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=token_expires_at,
            raw_profile=raw_profile or {},
        )
        db.add(identity)
        db.flush()
        return identity

    @staticmethod
    def unlink_account(db: Session, teacher_id: int, provider: str) -> bool:
        """Unlink an OAuth provider from a teacher.

        Returns True if an identity was found and deleted,
        False if no matching identity existed.
        Raises ValueError if unlinking would leave a passwordless account
        with no auth method.
        """
        from models.user import Teacher

        identity = (
            db.query(OAuthIdentity)
            .filter(
                OAuthIdentity.teacher_id == teacher_id,
                OAuthIdentity.provider == provider,
            )
            .first()
        )
        if identity:
            teacher = db.query(Teacher).get(teacher_id)
            if teacher and not teacher.has_password:
                linked_count = (
                    db.query(OAuthIdentity)
                    .filter(OAuthIdentity.teacher_id == teacher_id)
                    .count()
                )
                if linked_count <= 1:
                    raise ValueError(
                        "Cannot unlink last auth method on a passwordless account"
                    )
            db.delete(identity)
            db.flush()
            return True
        return False

    @staticmethod
    def get_linked_providers(db: Session, teacher_id: int) -> list[OAuthIdentity]:
        """Get all OAuth identities linked to a teacher.

        Returns a list of all connected provider accounts
        for displaying in the teacher's settings page.
        """
        return (
            db.query(OAuthIdentity).filter(OAuthIdentity.teacher_id == teacher_id).all()
        )

    @staticmethod
    def update_tokens(
        db: Session,
        teacher_id: int,
        provider: str,
        access_token: Optional[str] = None,
        refresh_token: Optional[str] = None,
        token_expires_at=None,
    ) -> Optional[OAuthIdentity]:
        """Update OAuth tokens for an existing identity.

        Called after token refresh to keep stored tokens current.
        """
        identity = (
            db.query(OAuthIdentity)
            .filter(
                OAuthIdentity.teacher_id == teacher_id,
                OAuthIdentity.provider == provider,
            )
            .first()
        )
        if identity:
            if access_token is not None:
                identity.access_token = access_token
            if refresh_token is not None:
                identity.refresh_token = refresh_token
            if token_expires_at is not None:
                identity.token_expires_at = token_expires_at
            db.flush()
        return identity
