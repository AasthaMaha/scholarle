"""initial persistence schema

Revision ID: 0001_initial_persistence_schema
Revises:
Create Date: 2026-07-02
"""

from alembic import op

from persistence.models import Base

revision = "0001_initial_persistence_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)

