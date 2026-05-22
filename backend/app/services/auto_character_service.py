"""自动角色服务 - 大纲生成后校验并自动补全缺失角色"""
from typing import List, Dict, Any, Optional, Callable, Awaitable
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import json
import re

from app.models.character import Character
from app.models.relationship import CharacterRelationship, Organization, OrganizationMember, RelationshipType
from app.models.project import Project
from app.services.ai_service import AIService
from app.services.prompt_service import PromptService
from app.logger import get_logger

logger = get_logger(__name__)


def _normalize_character_name(name: str) -> str:
    """归一化角色名称：去除括号后缀（如「影笔（独立制图师）」→「影笔」）"""
    # 去除中文括号和英文括号及其内容
    normalized = re.sub(r'[（(][^）)]*[）)]', '', name).strip()
    return normalized if normalized else name


# 组织名单字后缀
_ORG_SINGLE_SUFFIXES = frozenset(
    "帮派门会局阁宗族堂殿宫庄寨堡楼院社团盟党军营队所署寺观庵朝庭府"
)
# 组织名双字后缀（如「法则探索者小队」「暗影战队」）
_ORG_DOUBLE_SUFFIXES = (
    "小队", "部队", "分队", "战队", "纵队", "小组", "分会", "分部",
    "总部", "支部", "商会", "公会", "学派", "教派", "家族", "皇朝",
)


def _looks_like_organization(name: str) -> bool:
    """根据名称推断是否为组织（如「天机阁」「法则探索者小队」「青龙帮」）"""
    n = name.strip()
    if len(n) < 2:
        return False
    if n[-1] in _ORG_SINGLE_SUFFIXES:
        return True
    if len(n) >= 3 and n[-2:] in _ORG_DOUBLE_SUFFIXES:
        return True
    return False


class AutoCharacterService:
    """自动角色引入服务"""
    
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
            if char.background:
                parts.append(f"背景: {char.background[:50]}")
            lines.append(" ".join(parts))
        
        return "\n".join(lines)
    
    async def _generate_character_details(
        self,
        spec: Dict[str, Any],
        project: Project,
        existing_characters: List[Character],
        db: AsyncSession,
        user_id: str,
        enable_mcp: bool
    ) -> Dict[str, Any]:
        """生成角色详细信息"""
        
        # 🎯 获取项目职业列表
        from app.models.career import Career
        careers_result = await db.execute(
            select(Career)
            .where(Career.project_id == project.id)
            .order_by(Career.type, Career.name)
        )
        careers = careers_result.scalars().all()
        
        # 构建职业信息摘要（包含最高阶段信息）
        careers_info = ""
        if careers:
            main_careers = [c for c in careers if c.type == 'main']
            sub_careers = [c for c in careers if c.type == 'sub']
            
            if main_careers:
                careers_info += "\n\n可用主职业列表（请在career_info中填写职业名称和阶段）：\n"
                for career in main_careers:
                    careers_info += f"- 名称: {career.name}, 最高阶段: {career.max_stage}阶"
                    if career.description:
                        careers_info += f", 描述: {career.description[:50]}"
                    careers_info += "\n"
            
            if sub_careers:
                careers_info += "\n可用副职业列表（请在career_info中填写职业名称和阶段）：\n"
                for career in sub_careers[:5]:
                    careers_info += f"- 名称: {career.name}, 最高阶段: {career.max_stage}阶"
                    if career.description:
                        careers_info += f", 描述: {career.description[:50]}"
                    careers_info += "\n"
            
            careers_info += "\n⚠️ 重要提示：生成角色时，职业阶段不能超过该职业的最高阶段！\n"
        
        # 构建角色生成提示词
        template = await PromptService.get_template(
            "AUTO_CHARACTER_GENERATION",
            user_id,
            db
        )
        
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
            existing_characters=existing_chars_summary + careers_info,
            plot_context="根据剧情需要引入的新角色",
            character_specification=json.dumps(spec, ensure_ascii=False, indent=2),
            mcp_references=""  # MCP工具通过AI服务自动加载
        )
        
        logger.info(f"🔧 角色详情生成: enable_mcp={enable_mcp}")
        
        # 调用AI生成
        try:
            character_data = await self.ai_service.call_with_json_retry(
                prompt=prompt,
                max_retries=2,  # 减少重试次数以加快速度
            )
            
            char_name = character_data.get('name', '未知')
            logger.info(f"    ✅ 角色详情生成成功: {char_name}")
            logger.debug(f"       角色数据字段: {list(character_data.keys())}")
            
            # 确保关键字段存在
            if 'name' not in character_data or not character_data['name']:
                logger.warning(f"    ⚠️ AI返回的角色数据缺少name字段，使用规格中的信息")
                character_data['name'] = spec.get('name', f"新角色{spec.get('role_description', '')[:10]}")
            
            return character_data
            
        except Exception as e:
            logger.error(f"    ❌ 生成角色详情失败: {e}")
            raise
    
    async def _create_character_record(
        self,
        project_id: str,
        character_data: Dict[str, Any],
        db: AsyncSession
    ) -> Character:
        """创建角色数据库记录"""
        
        is_organization = character_data.get("is_organization", False)
        
        # 提取职业信息（支持通过名称匹配）
        career_info = character_data.get("career_info", {})
        raw_main_career_name = career_info.get("main_career_name") if career_info else None
        main_career_stage = career_info.get("main_career_stage", 1) if career_info else None
        raw_sub_careers_data = career_info.get("sub_careers", []) if career_info else []
        
        # 🔧 通过职业名称匹配数据库中的职业ID
        from app.models.career import Career, CharacterCareer
        main_career_id = None
        sub_careers_data = []
        
        # 匹配主职业名称
        if raw_main_career_name and not is_organization:
            career_check = await db.execute(
                select(Career).where(
                    Career.name == raw_main_career_name,
                    Career.project_id == project_id,
                    Career.type == 'main'
                )
            )
            matched_career = career_check.scalar_one_or_none()
            if matched_career:
                main_career_id = matched_career.id
                # ✅ 验证阶段不超过最高阶段
                if main_career_stage and main_career_stage > matched_career.max_stage:
                    logger.warning(f"    ⚠️ AI返回的主职业阶段({main_career_stage})超过最高阶段({matched_career.max_stage})，自动修正为最高阶段")
                    main_career_stage = matched_career.max_stage
                logger.info(f"    ✅ 主职业名称匹配成功: {raw_main_career_name} -> ID: {main_career_id}, 阶段: {main_career_stage}/{matched_career.max_stage}")
            else:
                logger.warning(f"    ⚠️ AI返回的主职业名称未找到: {raw_main_career_name}")
        
        # 匹配副职业名称
        if raw_sub_careers_data and not is_organization and isinstance(raw_sub_careers_data, list):
            for sub_data in raw_sub_careers_data[:2]:
                if isinstance(sub_data, dict):
                    career_name = sub_data.get('career_name')
                    if career_name:
                        career_check = await db.execute(
                            select(Career).where(
                                Career.name == career_name,
                                Career.project_id == project_id,
                                Career.type == 'sub'
                            )
                        )
                        matched_career = career_check.scalar_one_or_none()
                        if matched_career:
                            sub_stage = sub_data.get('stage', 1)
                            # ✅ 验证阶段不超过最高阶段
                            if sub_stage > matched_career.max_stage:
                                logger.warning(f"    ⚠️ AI返回的副职业阶段({sub_stage})超过最高阶段({matched_career.max_stage})，自动修正为最高阶段")
                                sub_stage = matched_career.max_stage
                            
                            sub_careers_data.append({
                                'career_id': matched_career.id,
                                'stage': sub_stage
                            })
                            logger.info(f"    ✅ 副职业名称匹配成功: {career_name} -> ID: {matched_career.id}, 阶段: {sub_stage}/{matched_career.max_stage}")
                        else:
                            logger.warning(f"    ⚠️ AI返回的副职业名称未找到: {career_name}")
        
        # 创建角色（不再写入 relationships 文本字段，关系统一由 character_relationships 表管理）
        character = Character(
            project_id=project_id,
            name=character_data.get("name", "未命名角色"),
            age=str(character_data.get("age", "")),
            gender=character_data.get("gender"),
            is_organization=is_organization,
            role_type=character_data.get("role_type", "supporting"),
            personality=character_data.get("personality", ""),
            background=character_data.get("background", ""),
            appearance=character_data.get("appearance", ""),
            organization_type=character_data.get("organization_type") if is_organization else None,
            organization_purpose=character_data.get("organization_purpose") if is_organization else None,
            traits=json.dumps(character_data.get("traits", []), ensure_ascii=False) if character_data.get("traits") else None,
            main_career_id=main_career_id,
            main_career_stage=main_career_stage if main_career_id else None,
            sub_careers=json.dumps(sub_careers_data, ensure_ascii=False) if sub_careers_data else None
        )
        
        db.add(character)
        await db.flush()
        
        # 处理主职业关联
        if main_career_id and not is_organization:
            char_career = CharacterCareer(
                character_id=character.id,
                career_id=main_career_id,
                career_type='main',
                current_stage=main_career_stage,
                stage_progress=0
            )
            db.add(char_career)
            logger.info(f"    ✅ 创建主职业关联: {character.name} -> {raw_main_career_name}")
        
        # 处理副职业关联
        if sub_careers_data and not is_organization:
            for sub_data in sub_careers_data:
                char_career = CharacterCareer(
                    character_id=character.id,
                    career_id=sub_data['career_id'],
                    career_type='sub',
                    current_stage=sub_data['stage'],
                    stage_progress=0
                )
                db.add(char_career)
            logger.info(f"    ✅ 创建副职业关联: {character.name}, 数量: {len(sub_careers_data)}")
        
        # 如果是组织，创建Organization记录
        if is_organization:
            org = Organization(
                character_id=character.id,
                project_id=project_id,
                member_count=0,
                power_level=character_data.get("power_level", 50),
                location=character_data.get("location"),
                motto=character_data.get("motto"),
                color=character_data.get("color")
            )
            db.add(org)
            await db.flush()
            logger.info(f"    ✅ 创建组织详情: {character.name}")
        
        return character
    
    async def _create_relationships(
        self,
        new_character: Character,
        relationship_specs: List[Dict[str, Any]],
        existing_characters: List[Character],
        project_id: str,
        db: AsyncSession
    ) -> List[CharacterRelationship]:
        """创建角色关系"""
        
        if not relationship_specs:
            return []
        
        relationships = []
        
        for rel_spec in relationship_specs:
            try:
                target_name = rel_spec.get("target_character_name")
                if not target_name:
                    continue
                
                # 查找目标角色（使用归一化名称匹配）
                target_char = next(
                    (c for c in existing_characters if _normalize_character_name(c.name) == _normalize_character_name(target_name)),
                    None
                )
                
                if not target_char:
                    logger.warning(f"    ⚠️ 目标角色不存在: {target_name}")
                    continue
                
                # 检查关系是否已存在
                existing_rel = await db.execute(
                    select(CharacterRelationship).where(
                        CharacterRelationship.project_id == project_id,
                        CharacterRelationship.character_from_id == new_character.id,
                        CharacterRelationship.character_to_id == target_char.id
                    )
                )
                if existing_rel.scalar_one_or_none():
                    logger.debug(f"    ℹ️ 关系已存在: {new_character.name} -> {target_name}")
                    continue
                
                # 创建关系
                relationship = CharacterRelationship(
                    project_id=project_id,
                    character_from_id=new_character.id,
                    character_to_id=target_char.id,
                    relationship_name=rel_spec.get("relationship_type", "未知关系"),
                    intimacy_level=rel_spec.get("intimacy_level", 50),
                    description=rel_spec.get("description", ""),
                    status=rel_spec.get("status", "active"),
                    source="auto"  # 标记为自动生成
                )
                
                # 尝试匹配预定义关系类型
                rel_type_name = rel_spec.get("relationship_type")
                if rel_type_name:
                    rel_type_result = await db.execute(
                        select(RelationshipType).where(
                            RelationshipType.name == rel_type_name
                        )
                    )
                    rel_type = rel_type_result.scalar_one_or_none()
                    if rel_type:
                        relationship.relationship_type_id = rel_type.id
                
                db.add(relationship)
                relationships.append(relationship)
                
                logger.info(
                    f"    ✅ 创建关系: {new_character.name} -> {target_name} "
                    f"({rel_spec.get('relationship_type', '未知')})"
                )
                
            except Exception as e:
                logger.warning(f"    ❌ 创建关系失败: {e}")
                continue
        
        return relationships


    async def check_and_create_missing_characters(
        self,
        project_id: str,
        outline_data_list: list,
        db: AsyncSession,
        user_id: str = None,
        enable_mcp: bool = True,
        progress_callback: Optional[Callable[[str], Awaitable[None]]] = None
    ) -> Dict[str, Any]:
        """
        根据大纲structure中的characters字段校验项目是否存在对应角色，
        如果不存在则根据大纲摘要自动生成角色信息。
        
        Args:
            project_id: 项目ID
            outline_data_list: 大纲数据列表（每个元素包含 characters、summary 等字段）
            db: 数据库会话
            user_id: 用户ID
            enable_mcp: 是否启用MCP
            progress_callback: 进度回调
            
        Returns:
            {
                "created_characters": [角色对象列表],
                "missing_names": [缺失的角色名称列表],
                "created_count": 创建的角色数量
            }
        """
        logger.info(f"🔍 【角色校验】开始校验大纲中提到的角色是否存在...")
        
        # 1. 从所有大纲的structure中提取角色名称（兼容新旧格式）
        # 使用归一化名称去重：如「影笔」和「影笔（独立制图师）」视为同一角色
        all_character_names = set()  # 存储归一化后的名称
        raw_to_normalized = {}  # 原始名称 -> 归一化名称
        character_context = {}  # 归一化名称 -> 上下文列表
        
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
                            # 跳过 organization 类型或空名
                            if entry_type == "organization" or not entry_name.strip():
                                continue
                            # 智能推断：AI误标为character的组织名（如「法则探索者小队」）
                            if _looks_like_organization(entry_name):
                                logger.info(f"  🔍 智能推断: '{entry_name}' 名称像组织，跳过角色创建（交由组织校验处理）")
                                continue
                            raw_name = entry_name.strip()
                        # 旧格式：纯字符串
                        elif isinstance(char_entry, str) and char_entry.strip():
                            raw_name = char_entry.strip()
                            # 旧格式也做智能推断
                            if _looks_like_organization(raw_name):
                                logger.info(f"  🔍 智能推断: '{raw_name}' 名称像组织，跳过角色创建")
                                continue
                        else:
                            continue
                        
                        # 归一化名称，去除括号后缀
                        normalized = _normalize_character_name(raw_name)
                        raw_to_normalized[raw_name] = normalized
                        all_character_names.add(normalized)
                        
                        # 收集角色出现的上下文（按归一化名称合并）
                        if normalized not in character_context:
                            character_context[normalized] = []
                        character_context[normalized].append(f"《{title}》: {summary[:200]}")
        
        if not all_character_names:
            logger.info("🔍 【角色校验】大纲中未提到任何角色，跳过校验")
            return {
                "created_characters": [],
                "missing_names": [],
                "created_count": 0
            }
        
        logger.info(f"🔍 【角色校验】大纲中提到的角色: {', '.join(all_character_names)}")
        
        # 2. 获取项目现有角色
        existing_result = await db.execute(
            select(Character).where(Character.project_id == project_id)
        )
        existing_characters = existing_result.scalars().all()
        # 使用归一化名称匹配，这样「影笔」和「影笔（独立制图师）」不会重复
        existing_names = {_normalize_character_name(char.name) for char in existing_characters}
        
        # 3. 找出缺失的角色（基于归一化名称匹配）
        missing_names = all_character_names - existing_names
        
        if not missing_names:
            logger.info("✅ 【角色校验】所有角色已存在，无需创建")
            return {
                "created_characters": [],
                "missing_names": [],
                "created_count": 0
            }
        
        logger.info(f"⚠️ 【角色校验】发现 {len(missing_names)} 个缺失角色: {', '.join(missing_names)}")
        
        # 4. 获取项目信息
        project_result = await db.execute(
            select(Project).where(Project.id == project_id)
        )
        project = project_result.scalar_one_or_none()
        if not project:
            logger.error("❌ 【角色校验】项目不存在")
            return {
                "created_characters": [],
                "missing_names": list(missing_names),
                "created_count": 0
            }
        
        # 5. 为每个缺失的角色生成并创建角色信息
        created_characters = []
        
        for idx, char_name in enumerate(missing_names):
            try:
                if progress_callback:
                    await progress_callback(
                        f"🎭 [{idx+1}/{len(missing_names)}] 自动创建角色：{char_name}..."
                    )
                
                # 构建角色规格（基于大纲上下文）
                context_summaries = character_context.get(char_name, [])
                context_text = "\n".join(context_summaries[:3])  # 最多3个上下文
                
                spec = {
                    "name": char_name,
                    "role_description": f"在大纲中出现的角色，出现场景：\n{context_text}",
                    "suggested_role_type": "supporting",
                    "importance": "medium",
                    "organization_check": "⚠️ 请先判断该名称是个人角色还是组织/势力/团体。如果该名称代表的是一个组织（如门派、小队、公司、帮会、机构等），请设置 is_organization: true 并按组织格式返回数据。"
                }
                
                logger.info(f"  🤖 [{idx+1}/{len(missing_names)}] 生成角色详情: {char_name}")
                
                # 生成角色详细信息
                character_data = await self._generate_character_details(
                    spec=spec,
                    project=project,
                    existing_characters=list(existing_characters) + created_characters,
                    db=db,
                    user_id=user_id,
                    enable_mcp=enable_mcp
                )
                
                # 检查AI是否判定该名称实际为组织
                if character_data.get("is_organization", False):
                    logger.info(f"  🏛️ AI判定 '{char_name}' 为组织/势力，将按组织格式创建")
                
                # 确保使用大纲中的角色名称
                character_data['name'] = char_name
                
                if progress_callback:
                    await progress_callback(
                        f"💾 [{idx+1}/{len(missing_names)}] 保存角色：{char_name}..."
                    )
                
                # 创建角色记录
                character = await self._create_character_record(
                    project_id=project_id,
                    character_data=character_data,
                    db=db
                )
                
                created_characters.append(character)
                logger.info(f"  ✅ [{idx+1}/{len(missing_names)}] 角色创建成功: {character.name}")
                
                # 建立关系
                relationships_data = character_data.get("relationships") or character_data.get("relationships_array", [])
                if relationships_data:
                    if progress_callback:
                        await progress_callback(
                            f"🔗 [{idx+1}/{len(missing_names)}] 建立 {len(relationships_data)} 个关系：{char_name}..."
                        )
                    
                    await self._create_relationships(
                        new_character=character,
                        relationship_specs=relationships_data,
                        existing_characters=list(existing_characters) + created_characters,
                        project_id=project_id,
                        db=db
                    )
                
                if progress_callback:
                    await progress_callback(
                        f"✅ [{idx+1}/{len(missing_names)}] 角色创建完成：{char_name}"
                    )
                
            except Exception as e:
                logger.error(f"  ❌ 创建角色 {char_name} 失败: {e}", exc_info=True)
                if progress_callback:
                    await progress_callback(
                        f"⚠️ [{idx+1}/{len(missing_names)}] 角色 {char_name} 创建失败"
                    )
                continue
        
        # 6. flush 到数据库（让调用方 commit）
        if created_characters:
            await db.flush()
        
        logger.info(f"🎉 【角色校验】完成: 发现 {len(missing_names)} 个缺失角色，成功创建 {len(created_characters)} 个")
        
        return {
            "created_characters": created_characters,
            "missing_names": list(missing_names),
            "created_count": len(created_characters)
        }


# 全局实例缓存
_auto_character_service_instance: Optional[AutoCharacterService] = None


def get_auto_character_service(ai_service: AIService) -> AutoCharacterService:
    """获取自动角色服务实例（单例模式）"""
    global _auto_character_service_instance
    if _auto_character_service_instance is None:
        _auto_character_service_instance = AutoCharacterService(ai_service)
    return _auto_character_service_instance