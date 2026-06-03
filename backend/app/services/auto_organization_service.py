"""自动组织服务 - 大纲生成后校验并自动补全缺失组织"""
from typing import List, Dict, Any, Optional, Callable, Awaitable
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import json
import re

from app.models.character import Character
from app.models.relationship import Organization, OrganizationMember
from app.models.project import Project
from app.services.ai_service import AIService
from app.services.prompt_service import PromptService
from app.logger import get_logger

logger = get_logger(__name__)


def _normalize_org_name(name: str) -> str:
    """归一化组织名称：去除括号后缀（如「暗影商会（地下）」→「暗影商会」）"""
    normalized = re.sub(r'[（(][^）)]*[）)]', '', name).strip()
    return normalized if normalized else name


class AutoOrganizationService:
    """自动组织引入服务"""
    
    def __init__(self, ai_service: AIService):
        self.ai_service = ai_service
    
    def _build_character_summary(self, characters: List[Character]) -> str:
        """构建现有角色摘要信息"""
        if not characters:
            return "暂无已有角色"
        
        lines = []
        for char in characters:
            parts = [f"- {char.name}"]
            if char.role_type:
                role_map = {"protagonist": "主角", "supporting": "配角", "antagonist": "反派"}
                parts.append(f"({role_map.get(char.role_type, char.role_type)})")
            if char.personality:
                parts.append(f"性格: {char.personality[:50]}")
            lines.append(" ".join(parts))
        
        return "\n".join(lines)
    
    def _build_organization_summary(self, organizations: List[Dict[str, Any]]) -> str:
        """构建现有组织摘要信息"""
        if not organizations:
            return "暂无已有组织"
        
        lines = []
        for org in organizations:
            name = org.get("name", "未知") if isinstance(org, dict) else getattr(org, "name", "未知")
            lines.append(f"- {name}")
        
        return "\n".join(lines)
    
    async def _generate_organization_details(
        self,
        spec: Dict[str, Any],
        project: Project,
        existing_characters: List[Character],
        existing_organizations: List[Dict[str, Any]],
        db: AsyncSession,
        user_id: str,
        enable_mcp: bool
    ) -> Dict[str, Any]:
        """生成组织详细信息"""
        
        # 构建组织生成提示词
        template = await PromptService.get_template(
            "AUTO_ORGANIZATION_GENERATION",
            user_id,
            db
        )
        
        existing_orgs_summary = self._build_organization_summary(existing_organizations)
        existing_chars_summary = self._build_character_summary(existing_characters)
        
        prompt = PromptService.format_prompt(
            template,
            title=project.title,
            genre=project.genre or "未设定",
            theme=project.theme or "未设定",
            time_period=project.world_time_period or "未设定",
            location=project.world_location or "未设定",
            atmosphere=project.world_atmosphere or "未设定",
            rules=project.world_rules or "未设定",
            existing_organizations=existing_orgs_summary,
            existing_characters=existing_chars_summary,
            plot_context="根据剧情需要引入的新组织",
            organization_specification=json.dumps(spec, ensure_ascii=False, indent=2),
            mcp_references=""  # 暂时不使用MCP增强
        )
        
        # 调用AI生成（使用统一的JSON调用方法）
        try:
            # 使用统一的JSON调用方法（支持自动MCP工具加载）
            organization_data = await self.ai_service.call_with_json_retry(
                prompt=prompt,
                max_retries=3,
            )
            
            org_name = organization_data.get('name', '未知')
            logger.info(f"    ✅ 组织详情生成成功: {org_name}")
            logger.debug(f"       组织数据字段: {list(organization_data.keys())}")
            
            # 确保关键字段存在
            if 'name' not in organization_data or not organization_data['name']:
                logger.warning(f"    ⚠️ AI返回的组织数据缺少name字段，使用规格中的信息")
                organization_data['name'] = spec.get('name', f"新组织{spec.get('organization_description', '')[:10]}")
            
            return organization_data
            
        except Exception as e:
            logger.error(f"    ❌ 生成组织详情失败: {e}")
            raise
    
    async def _create_organization_record(
        self,
        project_id: str,
        organization_data: Dict[str, Any],
        db: AsyncSession
    ) -> tuple:
        """创建组织数据库记录（包括Character和Organization）"""
        
        # 首先创建Character记录（is_organization=True）
        character = Character(
            project_id=project_id,
            name=organization_data.get("name", "未命名组织"),
            is_organization=True,
            role_type=organization_data.get("role_type", "supporting"),
            personality=organization_data.get("personality", ""),  # 组织特性
            background=organization_data.get("background", ""),  # 组织背景
            appearance=organization_data.get("appearance", ""),  # 外在表现
            organization_type=organization_data.get("organization_type"),
            organization_purpose=organization_data.get("organization_purpose"),
            traits=json.dumps(organization_data.get("traits", []), ensure_ascii=False) if organization_data.get("traits") else None
        )
        
        db.add(character)
        await db.flush()
        
        # 然后创建Organization记录
        organization = Organization(
            character_id=character.id,
            project_id=project_id,
            power_level=organization_data.get("power_level", 50),
            member_count=0,
            location=organization_data.get("location"),
            motto=organization_data.get("motto"),
            color=organization_data.get("color")
        )
        
        db.add(organization)
        await db.flush()
        
        logger.info(f"    ✅ 创建组织记录: {character.name}, Organization ID: {organization.id}")
        
        return character, organization
    
    async def _create_member_relationships(
        self,
        organization: Organization,
        member_specs: List[Dict[str, Any]],
        existing_characters: List[Character],
        project_id: str,
        db: AsyncSession
    ) -> List[OrganizationMember]:
        """创建组织成员关系"""
        
        if not member_specs:
            return []
        
        members = []
        
        for member_spec in member_specs:
            try:
                character_name = member_spec.get("character_name")
                if not character_name:
                    continue
                
                # 查找目标角色（使用归一化名称匹配）
                target_char = next(
                    (c for c in existing_characters if _normalize_org_name(c.name) == _normalize_org_name(character_name) and not c.is_organization),
                    None
                )
                
                if not target_char:
                    logger.warning(f"    ⚠️ 目标角色不存在: {character_name}")
                    continue
                
                # 检查成员关系是否已存在
                existing_member = await db.execute(
                    select(OrganizationMember).where(
                        OrganizationMember.organization_id == organization.id,
                        OrganizationMember.character_id == target_char.id
                    )
                )
                if existing_member.scalar_one_or_none():
                    logger.debug(f"    ℹ️ 成员关系已存在: {character_name} -> {organization.id}")
                    continue
                
                # 创建成员关系
                member = OrganizationMember(
                    organization_id=organization.id,
                    character_id=target_char.id,
                    position=member_spec.get("position", "成员"),
                    rank=member_spec.get("rank", 0),
                    loyalty=member_spec.get("loyalty", 50),
                    status=member_spec.get("status", "active"),
                    joined_at=member_spec.get("joined_at"),
                    source="auto"  # 标记为自动生成
                )
                
                db.add(member)
                members.append(member)
                
                logger.info(
                    f"    ✅ 创建成员关系: {character_name} -> {organization.id} "
                    f"({member_spec.get('position', '成员')})"
                )
                
            except Exception as e:
                logger.warning(f"    ❌ 创建成员关系失败: {e}")
                continue
        
        # 更新组织成员数量
        if members:
            organization.member_count = (organization.member_count or 0) + len(members)
        
        return members


    async def check_and_create_missing_organizations(
        self,
        project_id: str,
        outline_data_list: list,
        db: AsyncSession,
        user_id: str = None,
        enable_mcp: bool = True,
        progress_callback: Optional[Callable[[str], Awaitable[None]]] = None
    ) -> Dict[str, Any]:
        """
        根据大纲structure中的characters字段（type=organization）校验项目是否存在对应组织，
        如果不存在则根据大纲摘要自动生成组织信息。
        
        Args:
            project_id: 项目ID
            outline_data_list: 大纲数据列表（每个元素包含 characters、summary 等字段）
            db: 数据库会话
            user_id: 用户ID
            enable_mcp: 是否启用MCP
            progress_callback: 进度回调
            
        Returns:
            {
                "created_organizations": [组织对象列表],
                "missing_names": [缺失的组织名称列表],
                "created_count": 创建的组织数量
            }
        """
        logger.info(f"🔍 【组织校验】开始校验大纲中提到的组织是否存在...")
        
        # 1. 从所有大纲的structure中提取组织名称（兼容新旧格式）
        all_organization_names = set()
        organization_context = {}  # 记录组织出现的上下文（大纲摘要）
        
        for outline_item in outline_data_list:
            if isinstance(outline_item, dict):
                characters = outline_item.get("characters", [])
                summary = outline_item.get("summary", "") or outline_item.get("content", "")
                title = outline_item.get("title", "")
                
                if isinstance(characters, list):
                    for char_entry in characters:
                        # 新格式：{"name": "xxx", "type": "character"/"organization"}
                        if isinstance(char_entry, dict):
                            entry_type = char_entry.get("type", "character")
                            entry_name = char_entry.get("name", "")
                            # 只处理 organization 类型
                            if entry_type != "organization" or not entry_name.strip():
                                continue
                            raw_name = entry_name.strip()
                            # 归一化名称，去除括号后缀
                            name = _normalize_org_name(raw_name)
                            all_organization_names.add(name)
                            if name not in organization_context:
                                organization_context[name] = []
                            organization_context[name].append(f"《{title}》: {summary[:200]}")
                        # 旧格式：纯字符串，无法区分类型，跳过
        
        if not all_organization_names:
            logger.info("🔍 【组织校验】大纲中未提到任何组织，跳过校验")
            return {
                "created_organizations": [],
                "missing_names": [],
                "created_count": 0
            }
        
        logger.info(f"🔍 【组织校验】大纲中提到的组织: {', '.join(all_organization_names)}")
        
        # 2. 获取项目现有组织（通过Character表的is_organization字段）
        existing_result = await db.execute(
            select(Character).where(
                Character.project_id == project_id,
                Character.is_organization == True
            )
        )
        existing_org_characters = existing_result.scalars().all()
        existing_org_names = {_normalize_org_name(char.name) for char in existing_org_characters}
        
        # 3. 找出缺失的组织（基于归一化名称匹配）
        missing_names = all_organization_names - existing_org_names
        
        if not missing_names:
            logger.info("✅ 【组织校验】所有组织已存在，无需创建")
            return {
                "created_organizations": [],
                "missing_names": [],
                "created_count": 0
            }
        
        logger.info(f"⚠️ 【组织校验】发现 {len(missing_names)} 个缺失组织: {', '.join(missing_names)}")
        
        # 4. 获取项目信息
        project_result = await db.execute(
            select(Project).where(Project.id == project_id)
        )
        project = project_result.scalar_one_or_none()
        if not project:
            logger.error("❌ 【组织校验】项目不存在")
            return {
                "created_organizations": [],
                "missing_names": list(missing_names),
                "created_count": 0
            }
        
        # 5. 获取现有角色和组织信息
        all_chars_result = await db.execute(
            select(Character).where(Character.project_id == project_id)
        )
        existing_characters = list(all_chars_result.scalars().all())
        
        existing_organizations = []
        for char in existing_org_characters:
            org_result = await db.execute(
                select(Organization).where(Organization.character_id == char.id)
            )
            org = org_result.scalar_one_or_none()
            if org:
                existing_organizations.append({
                    "name": char.name,
                    "organization_type": char.organization_type,
                    "organization_purpose": char.organization_purpose,
                    "power_level": org.power_level,
                    "location": org.location,
                    "motto": org.motto
                })
        
        # 6. 为每个缺失的组织生成并创建组织信息
        created_organizations = []
        
        for idx, org_name in enumerate(missing_names):
            try:
                if progress_callback:
                    await progress_callback(
                        f"🏛️ [{idx+1}/{len(missing_names)}] 自动创建组织：{org_name}..."
                    )
                
                # 构建组织规格（基于大纲上下文）
                context_summaries = organization_context.get(org_name, [])
                context_text = "\n".join(context_summaries[:3])
                
                spec = {
                    "name": org_name,
                    "organization_description": f"在大纲中出现的组织/势力，出现场景：\n{context_text}",
                    "organization_type": "未知",
                    "importance": "medium"
                }
                
                logger.info(f"  🤖 [{idx+1}/{len(missing_names)}] 生成组织详情: {org_name}")
                
                # 生成组织详细信息
                organization_data = await self._generate_organization_details(
                    spec=spec,
                    project=project,
                    existing_characters=existing_characters,
                    existing_organizations=existing_organizations,
                    db=db,
                    user_id=user_id,
                    enable_mcp=enable_mcp
                )
                
                # 确保使用大纲中的组织名称
                organization_data['name'] = org_name
                
                if progress_callback:
                    await progress_callback(
                        f"💾 [{idx+1}/{len(missing_names)}] 保存组织：{org_name}..."
                    )
                
                # 创建组织记录
                org_character, organization = await self._create_organization_record(
                    project_id=project_id,
                    organization_data=organization_data,
                    db=db
                )
                
                created_organizations.append(org_character)
                existing_characters.append(org_character)
                existing_organizations.append({
                    "name": org_character.name,
                    "organization_type": org_character.organization_type,
                    "organization_purpose": org_character.organization_purpose,
                    "power_level": organization.power_level,
                    "location": organization.location,
                    "motto": organization.motto
                })
                logger.info(f"  ✅ [{idx+1}/{len(missing_names)}] 组织创建成功: {org_character.name}")
                
                # 建立成员关系
                members_data = organization_data.get("initial_members", [])
                if members_data:
                    if progress_callback:
                        await progress_callback(
                            f"🔗 [{idx+1}/{len(missing_names)}] 建立 {len(members_data)} 个成员关系：{org_name}..."
                        )
                    
                    await self._create_member_relationships(
                        organization=organization,
                        member_specs=members_data,
                        existing_characters=existing_characters,
                        project_id=project_id,
                        db=db
                    )
                
                if progress_callback:
                    await progress_callback(
                        f"✅ [{idx+1}/{len(missing_names)}] 组织创建完成：{org_name}"
                    )
                
            except Exception as e:
                logger.error(f"  ❌ 创建组织 {org_name} 失败: {e}", exc_info=True)
                if progress_callback:
                    await progress_callback(
                        f"⚠️ [{idx+1}/{len(missing_names)}] 组织 {org_name} 创建失败"
                    )
                continue
        
        # 7. flush 到数据库（让调用方 commit）
        if created_organizations:
            await db.flush()
        
        logger.info(f"🎉 【组织校验】完成: 发现 {len(missing_names)} 个缺失组织，成功创建 {len(created_organizations)} 个")
        
        return {
            "created_organizations": created_organizations,
            "missing_names": list(missing_names),
            "created_count": len(created_organizations)
        }


# 全局实例缓存
_auto_organization_service_instance: Optional[AutoOrganizationService] = None


def get_auto_organization_service(ai_service: AIService) -> AutoOrganizationService:
    """获取自动组织服务实例（单例模式）"""
    global _auto_organization_service_instance
    if _auto_organization_service_instance is None:
        _auto_organization_service_instance = AutoOrganizationService(ai_service)
    return _auto_organization_service_instance