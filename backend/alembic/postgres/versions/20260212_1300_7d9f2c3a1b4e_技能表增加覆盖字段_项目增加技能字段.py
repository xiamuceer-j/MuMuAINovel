from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '7d9f2c3a1b4e'
down_revision: Union[str, None] = 'c3b7a8e9d1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('skill_specs', sa.Column('api_provider_override', sa.String(length=32), nullable=True, comment='AI提供商覆盖'))
    op.add_column('skill_specs', sa.Column('model_override', sa.String(length=128), nullable=True, comment='模型覆盖'))
    op.add_column('skill_specs', sa.Column('temperature_override', sa.String(length=32), nullable=True, comment='温度覆盖'))
    op.add_column('skill_specs', sa.Column('max_tokens_override', sa.String(length=32), nullable=True, comment='最大tokens覆盖'))

    op.add_column('projects', sa.Column('active_skill_key', sa.String(length=64), nullable=True, comment='项目级技能'))
    op.create_index('idx_projects_active_skill_key', 'projects', ['active_skill_key'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_projects_active_skill_key', table_name='projects')
    op.drop_column('projects', 'active_skill_key')

    op.drop_column('skill_specs', 'max_tokens_override')
    op.drop_column('skill_specs', 'temperature_override')
    op.drop_column('skill_specs', 'model_override')
    op.drop_column('skill_specs', 'api_provider_override')
