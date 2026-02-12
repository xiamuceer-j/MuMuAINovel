from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8f1c2d3e4a5'
down_revision: Union[str, None] = '927bcb55b756'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'skill_specs',
        sa.Column('id', sa.String(length=36), nullable=False, comment='UUID'),
        sa.Column('skill_key', sa.String(length=64), nullable=False, comment='技能唯一标识'),
        sa.Column('name', sa.String(length=128), nullable=False, comment='技能名称'),
        sa.Column('description', sa.Text(), nullable=True, comment='技能描述'),
        sa.Column('content', sa.Text(), nullable=False, comment='技能内容（Markdown）'),
        sa.Column('allowed_tools', sa.Text(), nullable=True, comment='允许的工具列表（逗号分隔）'),
        sa.Column('source_path', sa.String(length=255), nullable=True, comment='来源路径'),
        sa.Column('is_builtin', sa.Boolean(), nullable=True, comment='是否内置'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True, comment='更新时间'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('skill_specs', schema=None) as batch_op:
        batch_op.create_index('ux_skill_specs_key', ['skill_key'], unique=True)


def downgrade() -> None:
    with op.batch_alter_table('skill_specs', schema=None) as batch_op:
        batch_op.drop_index('ux_skill_specs_key')
    op.drop_table('skill_specs')
