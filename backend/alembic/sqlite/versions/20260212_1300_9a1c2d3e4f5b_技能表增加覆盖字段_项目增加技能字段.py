from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9a1c2d3e4f5b'
down_revision: Union[str, None] = 'b8f1c2d3e4a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('skill_specs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('api_provider_override', sa.String(length=32), nullable=True, comment='AI提供商覆盖'))
        batch_op.add_column(sa.Column('model_override', sa.String(length=128), nullable=True, comment='模型覆盖'))
        batch_op.add_column(sa.Column('temperature_override', sa.String(length=32), nullable=True, comment='温度覆盖'))
        batch_op.add_column(sa.Column('max_tokens_override', sa.String(length=32), nullable=True, comment='最大tokens覆盖'))

    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.add_column(sa.Column('active_skill_key', sa.String(length=64), nullable=True, comment='项目级技能'))
        batch_op.create_index('idx_projects_active_skill_key', ['active_skill_key'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_index('idx_projects_active_skill_key')
        batch_op.drop_column('active_skill_key')

    with op.batch_alter_table('skill_specs', schema=None) as batch_op:
        batch_op.drop_column('max_tokens_override')
        batch_op.drop_column('temperature_override')
        batch_op.drop_column('model_override')
        batch_op.drop_column('api_provider_override')
