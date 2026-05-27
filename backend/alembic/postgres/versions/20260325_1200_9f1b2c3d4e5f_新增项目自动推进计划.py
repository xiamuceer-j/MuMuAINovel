"""新增项目自动推进计划

Revision ID: 9f1b2c3d4e5f
Revises: 6eb27fce64de
Create Date: 2026-03-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9f1b2c3d4e5f'
down_revision: Union[str, None] = '6eb27fce64de'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'project_generation_schedules',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('project_id', sa.String(length=36), nullable=False, comment='项目ID'),
        sa.Column('user_id', sa.String(length=100), nullable=False, comment='用户ID'),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.text('false'), comment='是否启用自动推进'),
        sa.Column('cron_expr', sa.String(length=100), nullable=False, server_default='0 9 * * *', comment='Cron表达式'),
        sa.Column('timezone', sa.String(length=100), nullable=False, server_default='Asia/Shanghai', comment='时区'),
        sa.Column('chapters_per_run', sa.Integer(), nullable=False, server_default='1', comment='每次触发生成章节数'),
        sa.Column('target_word_count', sa.Integer(), nullable=False, server_default='3000', comment='目标字数'),
        sa.Column('enable_analysis', sa.Boolean(), nullable=False, server_default=sa.text('false'), comment='是否启用同步分析'),
        sa.Column('enable_mcp', sa.Boolean(), nullable=False, server_default=sa.text('false'), comment='是否启用MCP增强'),
        sa.Column('max_retries', sa.Integer(), nullable=False, server_default='3', comment='最大重试次数'),
        sa.Column('model', sa.String(length=100), nullable=True, comment='指定使用的模型'),
        sa.Column('min_ready_chapters', sa.Integer(), nullable=False, server_default='3', comment='最少待写章节缓冲数'),
        sa.Column('outline_batch_size', sa.Integer(), nullable=False, server_default='1', comment='每次补充大纲数量'),
        sa.Column('chapters_per_outline', sa.Integer(), nullable=False, server_default='3', comment='每个大纲默认展开章节数'),
        sa.Column('expansion_strategy', sa.String(length=50), nullable=False, server_default='balanced', comment='展开策略'),
        sa.Column('enable_scene_analysis', sa.Boolean(), nullable=False, server_default=sa.text('false'), comment='是否启用场景分析'),
        sa.Column('last_pipeline_stage', sa.String(length=50), nullable=True, comment='最近一次执行到的流水线阶段'),
        sa.Column('next_run_at', sa.DateTime(), nullable=True, comment='下一次执行时间'),
        sa.Column('last_triggered_at', sa.DateTime(), nullable=True, comment='最近触发时间'),
        sa.Column('last_finished_at', sa.DateTime(), nullable=True, comment='最近完成时间'),
        sa.Column('last_run_status', sa.String(length=50), nullable=True, comment='最近运行状态'),
        sa.Column('last_error', sa.Text(), nullable=True, comment='最近错误信息'),
        sa.Column('current_batch_task_id', sa.String(length=36), nullable=True, comment='当前关联的批量任务ID'),
        sa.Column('created_at', sa.DateTime(), nullable=True, server_default=sa.text('now()'), comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(), nullable=True, server_default=sa.text('now()'), comment='更新时间'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id')
    )
    op.create_index(op.f('ix_project_generation_schedules_user_id'), 'project_generation_schedules', ['user_id'], unique=False)
    op.create_index('idx_project_generation_schedules_enabled_next_run_at', 'project_generation_schedules', ['enabled', 'next_run_at'], unique=False)

    op.add_column('batch_generation_tasks', sa.Column('enable_mcp', sa.Boolean(), nullable=False, server_default=sa.text('true'), comment='是否启用MCP工具增强'))
    op.add_column('batch_generation_tasks', sa.Column('model_name', sa.String(length=100), nullable=True, comment='指定使用的AI模型'))
    op.add_column('batch_generation_tasks', sa.Column('trigger_source', sa.String(length=30), nullable=False, server_default='manual', comment='任务触发来源: manual/schedule'))
    op.add_column('batch_generation_tasks', sa.Column('schedule_id', sa.String(length=36), nullable=True, comment='关联的自动推进计划ID'))


def downgrade() -> None:
    op.drop_column('batch_generation_tasks', 'schedule_id')
    op.drop_column('batch_generation_tasks', 'trigger_source')
    op.drop_column('batch_generation_tasks', 'model_name')
    op.drop_column('batch_generation_tasks', 'enable_mcp')

    op.drop_index('idx_project_generation_schedules_enabled_next_run_at', table_name='project_generation_schedules')
    op.drop_index(op.f('ix_project_generation_schedules_user_id'), table_name='project_generation_schedules')
    op.drop_table('project_generation_schedules')
